// MediaRecorder 래퍼: 청크 수집, 일시정지 시간 제외 경과 시간, 안전한 종료/취소.

import fixWebmDuration from 'fix-webm-duration';

export interface RecorderOptions {
  mimeType: string;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  /** 데이터 손실을 줄이기 위해 주기적으로 청크를 받는다. */
  timesliceMs?: number;
}

export interface RecordingResult {
  blob: Blob;
  durationMs: number;
  mimeType: string;
  /** 비정상 종료(장치 분리 등)로 끝났는지 */
  interrupted: boolean;
}

/** 정지 시 첫 녹화 데이터를 기다리는 최대 시간 */
export const FIRST_DATA_WAIT_MS = 4000;

export type RecorderPhase = 'inactive' | 'recording' | 'paused';

export function canPauseRecording(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.prototype.pause === 'function' &&
    typeof MediaRecorder.prototype.resume === 'function'
  );
}

export class StudioRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt = 0;
  private cancelled = false;
  private stopRequested = false;
  private stopPromise: Promise<RecordingResult | null> | null = null;
  private resolveStop: ((r: RecordingResult | null) => void) | null = null;
  bytesSoFar = 0;

  /** 사용자가 요청하지 않은 종료(트랙 종료, 내부 오류)가 발생했을 때 호출된다. */
  onUnexpectedStop: ((result: RecordingResult | null, reason: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  get phase(): RecorderPhase {
    return (this.recorder?.state as RecorderPhase | undefined) ?? 'inactive';
  }

  get mimeType(): string {
    return this.recorder?.mimeType ?? '';
  }

  elapsedMs(now = performance.now()): number {
    if (!this.recorder || this.startedAt === 0) return 0;
    const pausedNow = this.recorder.state === 'paused' ? now - this.pausedAt : 0;
    return Math.max(0, now - this.startedAt - this.pausedTotal - pausedNow);
  }

  start(stream: MediaStream, opts: RecorderOptions): void {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('이 브라우저는 MediaRecorder(동영상 녹화)를 지원하지 않습니다.');
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      throw new Error('이미 녹화 중입니다.');
    }
    const options: MediaRecorderOptions = {};
    if (opts.mimeType) options.mimeType = opts.mimeType;
    if (opts.videoBitsPerSecond) options.videoBitsPerSecond = opts.videoBitsPerSecond;
    if (opts.audioBitsPerSecond) options.audioBitsPerSecond = opts.audioBitsPerSecond;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, options);
    } catch (e) {
      // 일부 모바일 브라우저(구형 iOS 등)는 형식 지정이나 비트레이트 옵션을 거부한다 → 브라우저 기본값으로 재시도
      if (!options.mimeType && !options.videoBitsPerSecond) throw e;
      rec = new MediaRecorder(stream);
    }
    this.recorder = rec;
    this.chunks = [];
    this.bytesSoFar = 0;
    this.cancelled = false;
    this.stopRequested = false;
    this.pausedTotal = 0;
    this.pausedAt = 0;
    this.stopPromise = new Promise((resolve) => (this.resolveStop = resolve));

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        this.bytesSoFar += e.data.size;
      }
    };
    rec.onerror = (e) => {
      const err = (e as unknown as { error?: DOMException }).error;
      this.onError?.(err?.message || '녹화 중 알 수 없는 오류가 발생했습니다.');
    };
    rec.onpause = () => {
      this.pausedAt = performance.now();
    };
    rec.onresume = () => {
      if (this.pausedAt) this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = 0;
    };
    rec.onstop = () => {
      void this.finalize();
    };
    rec.start(opts.timesliceMs ?? 1000);
    this.startedAt = performance.now();
  }

  pause(): boolean {
    if (!this.recorder || this.recorder.state !== 'recording' || !canPauseRecording()) return false;
    this.recorder.pause();
    return true;
  }

  resume(): boolean {
    if (!this.recorder || this.recorder.state !== 'paused') return false;
    this.recorder.resume();
    return true;
  }

  /** 녹화를 정상 종료하고 결과 파일을 돌려준다. */
  async stop(): Promise<RecordingResult | null> {
    if (!this.recorder || !this.stopPromise) return null;
    this.stopRequested = true;
    const rec = this.recorder;
    if (rec.state !== 'inactive') {
      // 인코더가 첫 데이터를 내기 전에 정지하면 빈 파일이 된다(느린 휴대폰·CPU 부하·아주 짧은 녹화).
      // 첫 데이터가 도착할 때까지(최대 FIRST_DATA_WAIT_MS) 데이터를 요청하며 기다린 뒤 정지한다.
      await this.waitForFirstData(rec);
      // await 동안 브라우저가 스스로 녹화를 끝냈을 수 있다.
      if ((rec.state as RecordingState) !== 'inactive') {
        try {
          rec.requestData();
        } catch {
          /* 일부 브라우저는 paused 상태에서 requestData 를 거부한다 */
        }
        rec.stop();
      }
    }
    return this.stopPromise;
  }

  private async waitForFirstData(rec: MediaRecorder): Promise<void> {
    const deadline = performance.now() + FIRST_DATA_WAIT_MS;
    while (this.bytesSoFar === 0 && rec.state !== 'inactive' && performance.now() < deadline) {
      if (rec.state === 'paused') {
        // 일시정지 중에는 새 프레임이 들어오지 않으므로 잠깐 재개해 데이터를 받는다.
        try {
          rec.resume();
        } catch {
          break;
        }
      }
      try {
        rec.requestData();
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** 녹화를 취소하고 데이터를 폐기한다. */
  cancel(): void {
    this.cancelled = true;
    this.stopRequested = true;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
  }

  private async finalize(): Promise<void> {
    const rec = this.recorder;
    const durationMs = this.elapsedMsAtStop();
    const unexpected = !this.stopRequested;
    let result: RecordingResult | null = null;
    if (!this.cancelled && this.chunks.length > 0) {
      const type = rec?.mimeType || this.chunks[0].type || 'video/webm';
      let blob = new Blob(this.chunks, { type });
      if (type.includes('webm')) {
        // Chrome 의 WebM 은 duration 메타데이터가 없어 탐색이 안 되는 문제를 보정한다.
        try {
          blob = await fixWebmDuration(blob, durationMs, { logger: false });
        } catch {
          /* 보정 실패 시 원본 사용 */
        }
      }
      result = { blob, durationMs, mimeType: type, interrupted: unexpected };
    }
    this.chunks = [];
    this.startedAt = 0;
    this.resolveStop?.(result);
    this.resolveStop = null;
    if (unexpected && !this.cancelled) {
      this.onUnexpectedStop?.(result, '녹화가 예기치 않게 중단되었습니다.');
    }
  }

  private elapsedMsAtStop(): number {
    if (this.startedAt === 0) return 0;
    const now = performance.now();
    const pausedNow = this.pausedAt ? now - this.pausedAt : 0;
    return Math.max(0, now - this.startedAt - this.pausedTotal - pausedNow);
  }
}
