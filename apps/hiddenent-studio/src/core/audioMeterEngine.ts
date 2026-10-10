// Web Audio API 기반 입력 레벨 분석기.
//
// 녹음 스트림과 분석 스트림을 분리하기 위해 녹음에 쓰는 트랙을 그대로 쓰지 않고
// track.clone() 으로 복제한 트랙을 분석한다. 분석 그래프는 AudioContext.destination 에
// 연결하지 않으므로 스피커로 소리가 나가지 않는다(피드백·하울링 방지).
//
// 일부 iOS Safari 버전은 복제 트랙에서 무음만 나오는 문제가 있다. 원본 트랙이 활성(음소거 아님)인데
// 복제본이 약 3초간 완전한 디지털 무음이면 원본 트랙을 '읽기 전용'으로 분석하도록 바꾼다.
// MediaStreamAudioSourceNode 는 원본 트랙을 읽기만 하므로 녹음 데이터는 바뀌지 않는다.
//
// AudioContext 는 앱 전체가 공유하며(모바일의 개수 제한·자동재생 정책 대응), 여기서 닫지 않는다.

import { ChannelLevel, looksMono, measureChannel } from './audioLevel';
import { getSharedAudioContext } from './mobile';

export interface MeterReading {
  left: ChannelLevel;
  right: ChannelLevel;
  /** 입력이 모노로 판단되어 L/R 을 같은 값으로 표시하는 중인지 */
  mono: boolean;
}

export type MeterEngineState = 'idle' | 'running' | 'suspended' | 'error';

/** 복제 트랙이 이 횟수(약 60fps 기준 3초) 연속으로 완전 무음이면 원본 분석으로 전환한다. */
export const CLONE_SILENCE_FRAMES = 180;

export function shouldFallbackToOriginal(zeroFrames: number, usingClone: boolean, original: { enabled: boolean; readyState: string } | null): boolean {
  return usingClone && zeroFrames >= CLONE_SILENCE_FRAMES && !!original && original.enabled && original.readyState === 'live';
}

export class AudioMeterEngine {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private analysers: [AnalyserNode, AnalyserNode] | null = null;
  private buffers: [Float32Array, Float32Array] | null = null;
  private analysisTrack: MediaStreamTrack | null = null;
  private recordTrack: MediaStreamTrack | null = null;
  private usingClone = true;
  private zeroFrames = 0;
  private declaredChannels: number | undefined;
  private monoVotes = 0;
  state: MeterEngineState = 'idle';
  error: string | null = null;

  get sampleRate(): number | null {
    return this.ctx ? this.ctx.sampleRate : null;
  }

  get contextState(): AudioContextState | null {
    return this.ctx ? this.ctx.state : null;
  }

  /** 복제 트랙 대신 원본 트랙을 읽고 있는지(iOS 대체 경로) */
  get analysingOriginal(): boolean {
    return !this.usingClone && this.analysers !== null;
  }

  /** 녹음용 트랙을 받아 복제본으로 분석을 시작한다. */
  async start(recordTrack: MediaStreamTrack): Promise<void> {
    this.stop();
    try {
      const ctx = getSharedAudioContext();
      if (!ctx) throw new Error('이 브라우저는 Web Audio API(AudioContext)를 지원하지 않습니다.');
      this.ctx = ctx;
      this.recordTrack = recordTrack;
      this.declaredChannels = recordTrack.getSettings().channelCount;
      this.connect(true);
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          /* 사용자 제스처가 필요할 수 있다 — resume() 을 다시 호출한다. */
        }
      }
      this.state = ctx.state === 'running' ? 'running' : 'suspended';
      this.error = null;
    } catch (err) {
      this.stop();
      this.state = 'error';
      this.error = err instanceof Error ? err.message : '오디오 분석기를 시작할 수 없습니다.';
      throw err;
    }
  }

  private connect(useClone: boolean): void {
    const ctx = this.ctx;
    const track = this.recordTrack;
    if (!ctx || !track) return;
    this.disconnectGraph();
    let input = track;
    if (useClone) {
      const clone = track.clone();
      // 분석용 복제 트랙은 음소거 상태와 무관하게 입력을 보여주도록 항상 활성화한다.
      clone.enabled = true;
      this.analysisTrack = clone;
      input = clone;
    }
    this.usingClone = useClone;
    this.zeroFrames = 0;
    const source = ctx.createMediaStreamSource(new MediaStream([input]));
    const splitter = ctx.createChannelSplitter(2);
    const mk = () => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0;
      return a;
    };
    const left = mk();
    const right = mk();
    if (this.declaredChannels === 1) {
      // 모노 입력은 업믹스 시 오른쪽이 무음이 되므로 같은 신호를 양쪽에 연결한다.
      source.connect(left);
      source.connect(right);
    } else {
      source.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
    }
    this.source = source;
    this.splitter = splitter;
    this.analysers = [left, right];
    this.buffers = [new Float32Array(left.fftSize), new Float32Array(right.fftSize)];
  }

  async resume(): Promise<void> {
    if (!this.ctx) return;
    await this.ctx.resume();
    this.state = this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  read(): MeterReading | null {
    if (!this.analysers || !this.buffers || !this.ctx) return null;
    if (this.ctx.state !== 'running') {
      this.state = 'suspended';
      return null;
    }
    this.state = 'running';
    const [la, ra] = this.analysers;
    const [lb, rb] = this.buffers;
    la.getFloatTimeDomainData(lb);
    ra.getFloatTimeDomainData(rb);
    const left = measureChannel(lb);
    let right = measureChannel(rb);
    if (left.peak === 0 && right.peak === 0) this.zeroFrames++;
    else this.zeroFrames = 0;
    if (shouldFallbackToOriginal(this.zeroFrames, this.usingClone, this.recordTrack)) {
      this.connect(false);
      return null;
    }
    let mono = this.declaredChannels === 1;
    if (!mono) {
      // 채널 수를 알 수 없는 경우: 오른쪽이 계속 완전 무음이면 모노로 판단한다.
      if (looksMono(left, right)) this.monoVotes = Math.min(this.monoVotes + 1, 60);
      else if (right.peak > 0) this.monoVotes = 0;
      if (this.monoVotes >= 30) {
        mono = true;
        right = left;
      }
    } else {
      right = left;
    }
    return { left, right, mono };
  }

  private disconnectGraph(): void {
    try {
      this.source?.disconnect();
      this.splitter?.disconnect();
      this.analysers?.forEach((a) => a.disconnect());
    } catch {
      /* 이미 해제됨 */
    }
    this.analysisTrack?.stop();
    this.source = null;
    this.splitter = null;
    this.analysers = null;
    this.buffers = null;
    this.analysisTrack = null;
  }

  /** 분석 그래프와 복제 트랙만 정리한다. 녹음용 원본 트랙과 공유 AudioContext 는 건드리지 않는다. */
  stop(): void {
    this.disconnectGraph();
    this.ctx = null;
    this.recordTrack = null;
    this.usingClone = true;
    this.zeroFrames = 0;
    this.monoVotes = 0;
    this.state = 'idle';
  }
}
