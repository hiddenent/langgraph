// 동영상 녹화 제어: 카운트다운 → 녹화 → 일시정지/재개 → 저장 또는 취소.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasPipeline, canvasCaptureSupported } from '../core/canvasPipeline';
import { RecordingFormat, extensionForMime, getSupportedFormats, pickFormat } from '../core/codecs';
import { runCountdown } from '../core/countdown';
import { buildFileName, formatBitrate } from '../core/format';
import { makeThumbnail } from '../core/photo';
import { StudioRecorder, canPauseRecording } from '../core/recorder';
import { Settings, videoBitrateFor } from '../core/settings';
import { countdownBeep, recordStartSound } from '../core/sound';
import { MediaItem, newId } from '../core/storage';

function ratioLabel(r: number): string {
  const known: [number, string][] = [[16 / 9, '16:9'], [9 / 16, '9:16'], [4 / 3, '4:3'], [3 / 4, '3:4'], [1, '1:1']];
  const hit = known.find(([v]) => Math.abs(v - r) < 0.01);
  return hit ? hit[1] : r.toFixed(2);
}

export type RecordPhase = 'idle' | 'countdown' | 'recording' | 'paused' | 'finalizing';

export interface RecordingPlan {
  pipeline: 'direct' | 'canvas';
  reason: string;
}

export interface VideoRecorderHandle {
  phase: RecordPhase;
  countdownLeft: number;
  elapsedMs: number;
  bytes: number;
  formats: RecordingFormat[];
  activeFormat: RecordingFormat | null;
  plan: RecordingPlan;
  canPause: boolean;
  lastResult: MediaItem | null;
  clearLastResult(): void;
  start(): Promise<void>;
  stop(reason?: string, interrupted?: boolean): Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
  cancelCountdown(): void;
  handleTrackEnded(kind: 'camera' | 'microphone'): void;
}

interface Options {
  settings: Settings;
  videoEl: React.RefObject<HTMLVideoElement>;
  cameraTrack: MediaStreamTrack | null;
  micTrack: MediaStreamTrack | null;
  micLabel: string;
  digitalZoom: number;
  /** 실제 적용할 화면 비율(휴대폰 세로 방향 자동 전환 반영) */
  aspectRatio: number;
  /** 미리보기 video 요소가 보고한 실제 프레임 크기 */
  videoSize: { w: number; h: number };
  onSaved: (item: MediaItem) => void;
  notify: (kind: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
}

export function useVideoRecorder(o: Options): VideoRecorderHandle {
  const { settings, videoEl, micTrack } = o;
  const [phase, setPhase] = useState<RecordPhase>('idle');
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [elapsedMs, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [lastResult, setLastResult] = useState<MediaItem | null>(null);
  const recRef = useRef<StudioRecorder | null>(null);
  const pipeRef = useRef<CanvasPipeline | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startInfo = useRef<{
    date: Date;
    thumb: string;
    width: number;
    height: number;
    format: RecordingFormat;
    requestedBitrate?: number;
    audio: boolean;
    pipeline: string;
    frameRate?: number;
  } | null>(null);
  const seqRef = useRef(1);
  const optsRef = useRef(o);
  optsRef.current = o;

  const includeAudio = settings.video.includeAudio && Boolean(micTrack) && micTrack?.readyState === 'live';
  const formats = useMemo(() => getSupportedFormats(includeAudio), [includeAudio]);
  const activeFormat = useMemo(() => pickFormat(formats, settings.video.format), [formats, settings.video.format]);

  const plan = useMemo<RecordingPlan>(() => {
    const reasons: string[] = [];
    const { w, h } = o.videoSize;
    const target = o.aspectRatio;
    if (w && h && Math.abs(w / h - target) / target > 0.02) reasons.push(`카메라 출력 비율(${w}×${h})을 ${ratioLabel(target)}로 자르기`);
    if (o.digitalZoom > 1.001) reasons.push(`디지털 확대 ${o.digitalZoom.toFixed(1)}× 적용`);
    if (settings.video.mirrorFile) reasons.push('파일 좌우 반전 저장');
    if (reasons.length === 0) return { pipeline: 'direct', reason: '카메라 원본 스트림을 그대로 녹화(최고 품질)' };
    if (!canvasCaptureSupported()) {
      return { pipeline: 'direct', reason: `이 브라우저는 캔버스 녹화를 지원하지 않아 원본 그대로 녹화합니다(${reasons.join(', ')} 미적용)` };
    }
    return { pipeline: 'canvas', reason: `캔버스 처리 녹화: ${reasons.join(', ')}` };
  }, [o.videoSize, o.aspectRatio, settings.video.mirrorFile, o.digitalZoom]);

  // 경과 시간 표시 및 시간 제한
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const id = window.setInterval(() => {
      const rec = recRef.current;
      if (!rec) return;
      const ms = rec.elapsedMs();
      setElapsed(ms);
      setBytes(rec.bytesSoFar);
      const limit = optsRef.current.settings.video.timeLimitSec;
      if (limit > 0 && ms >= limit * 1000 && rec.phase === 'recording') {
        void stopRef.current('설정한 녹화 시간 제한에 도달해 자동으로 저장했습니다.');
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  const finalizeItem = useCallback(
    (blob: Blob, durationMs: number, mimeType: string, interrupted: boolean): MediaItem | null => {
      const info = startInfo.current;
      if (!info) return null;
      const v = videoEl.current;
      const endThumb = v ? makeThumbnail(v, 480) : '';
      const ext = extensionForMime(mimeType);
      const actualBps = durationMs > 0 ? (blob.size * 8) / (durationMs / 1000) : 0;
      const item: MediaItem = {
        id: newId(),
        kind: 'video',
        name: buildFileName(optsRef.current.settings.video.fileTemplate, {
          kind: 'video',
          date: info.date,
          seq: seqRef.current++,
          extension: ext,
        }),
        mime: mimeType,
        size: blob.size,
        createdAt: info.date.getTime(),
        width: info.width,
        height: info.height,
        durationMs,
        thumbnail: info.thumb,
        beforeThumb: info.thumb,
        afterThumb: endThumb,
        blob,
        persisted: false,
        meta: {
          형식: info.format.label,
          'MIME 타입': mimeType,
          '녹화 방식': info.pipeline,
          '요청 비트레이트': info.requestedBitrate ? formatBitrate(info.requestedBitrate) : '브라우저 자동',
          '실제 평균 비트레이트': formatBitrate(actualBps),
          '프레임 레이트(카메라 보고값)': info.frameRate ? `${Math.round(info.frameRate * 100) / 100} fps` : '확인 불가',
          오디오: info.audio ? `포함 (${optsRef.current.micLabel || '마이크'})` : '없음',
          ...(interrupted ? { 상태: '중단됨(장치 분리/오류) — 중단 시점까지 저장' } : {}),
        },
      };
      return item;
    },
    [videoEl],
  );

  const cleanup = useCallback(() => {
    pipeRef.current?.stop();
    pipeRef.current = null;
    recRef.current = null;
    startInfo.current = null;
  }, []);

  const stop = useCallback(
    async (reason?: string, interrupted = false) => {
      const rec = recRef.current;
      if (!rec) return;
      setPhase('finalizing');
      let result = null;
      try {
        result = await rec.stop();
      } catch {
        result = null;
      }
      if (!result || result.blob.size === 0) {
        optsRef.current.notify('error', '녹화 파일을 만들지 못했습니다. 녹화 시간이 너무 짧거나 브라우저가 데이터를 반환하지 않았습니다.');
      } else {
        const item = finalizeItem(result.blob, result.durationMs, result.mimeType, interrupted);
        if (item) {
          optsRef.current.onSaved(item);
          setLastResult(item);
          optsRef.current.notify(reason ? 'warning' : 'success', reason ?? `녹화 완료: ${item.name}`);
        }
      }
      cleanup();
      setPhase('idle');
      setElapsed(0);
      setBytes(0);
    },
    [finalizeItem, cleanup],
  );
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const beginRecording = useCallback(() => {
    const { settings: s, cameraTrack: cam, micTrack: mic } = optsRef.current;
    const v = videoEl.current;
    if (!cam || cam.readyState !== 'live' || !v) {
      optsRef.current.notify('error', '카메라가 연결되어 있지 않아 녹화를 시작할 수 없습니다.');
      setPhase('idle');
      return;
    }
    const format = activeFormat;
    if (!format) {
      optsRef.current.notify('error', '이 브라우저는 지원하는 녹화 코덱이 없습니다. 최신 Chrome, Edge, Firefox, Safari 를 사용하세요.');
      setPhase('idle');
      return;
    }
    let videoTrack: MediaStreamTrack = cam;
    let width = v.videoWidth || cam.getSettings().width || 0;
    let height = v.videoHeight || cam.getSettings().height || 0;
    let pipelineLabel = '원본 스트림 직접 녹화';
    if (plan.pipeline === 'canvas') {
      try {
        const pipe = new CanvasPipeline(v, {
          aspect: optsRef.current.aspectRatio,
          zoom: optsRef.current.digitalZoom,
          mirror: s.video.mirrorFile,
          fps: s.video.frameRate,
          maxLongEdge: 3840,
        });
        const ps = pipe.start();
        pipeRef.current = pipe;
        videoTrack = ps.getVideoTracks()[0];
        width = pipe.size.width;
        height = pipe.size.height;
        pipelineLabel = '캔버스 처리 녹화(비율 자르기/확대/반전)';
      } catch {
        optsRef.current.notify('warning', '캔버스 처리 녹화를 시작하지 못해 원본 스트림으로 녹화합니다.');
      }
    }
    const tracks: MediaStreamTrack[] = [videoTrack];
    const withAudio = s.video.includeAudio && mic && mic.readyState === 'live';
    if (withAudio && mic) tracks.push(mic);
    const requestedBitrate = videoBitrateFor(s.video.quality, s.video.customBitrate, Math.min(width, height) || 1080);
    const rec = new StudioRecorder();
    rec.onError = (msg) => optsRef.current.notify('error', `녹화 오류: ${msg}`);
    rec.onUnexpectedStop = (result) => {
      // 브라우저가 스스로 녹화를 끝낸 경우(모든 트랙 종료 등) 받은 데이터까지 저장한다.
      if (result && result.blob.size > 0) {
        const item = finalizeItem(result.blob, result.durationMs, result.mimeType, true);
        if (item) {
          optsRef.current.onSaved(item);
          setLastResult(item);
        }
        optsRef.current.notify('warning', '녹화가 예기치 않게 중단되어 중단 시점까지의 내용을 저장했습니다.');
      } else {
        optsRef.current.notify('error', '녹화가 예기치 않게 중단되었고 저장할 데이터가 없습니다.');
      }
      cleanup();
      setPhase('idle');
    };
    try {
      rec.start(new MediaStream(tracks), {
        mimeType: format.mimeType,
        videoBitsPerSecond: requestedBitrate,
        audioBitsPerSecond: withAudio ? s.audio.bitrate : undefined,
        timesliceMs: 1000,
      });
    } catch (e) {
      pipeRef.current?.stop();
      pipeRef.current = null;
      optsRef.current.notify(
        'error',
        `녹화를 시작하지 못했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}. 다른 녹화 형식을 선택해 보세요.`,
      );
      setPhase('idle');
      return;
    }
    recRef.current = rec;
    startInfo.current = {
      date: new Date(),
      thumb: makeThumbnail(v, 480),
      width,
      height,
      format,
      requestedBitrate,
      audio: Boolean(withAudio),
      pipeline: pipelineLabel,
      frameRate: cam.getSettings().frameRate,
    };
    if (s.ui.countdownSound) recordStartSound();
    setElapsed(0);
    setPhase('recording');
  }, [activeFormat, plan.pipeline, videoEl, finalizeItem, cleanup]);

  const start = useCallback(async () => {
    if (phase !== 'idle') return;
    const s = optsRef.current.settings;
    if (s.video.countdown > 0) {
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase('countdown');
      const ok = await runCountdown(
        s.video.countdown,
        (left) => {
          setCountdownLeft(left);
          if (left > 0 && s.ui.countdownSound) countdownBeep(left === 1);
        },
        ac.signal,
      );
      abortRef.current = null;
      if (!ok) {
        setPhase('idle');
        return;
      }
    }
    beginRecording();
  }, [phase, beginRecording]);

  const cancelCountdown = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const pause = useCallback(() => {
    if (recRef.current?.pause()) setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    if (recRef.current?.resume()) setPhase('recording');
  }, []);

  const cancel = useCallback(() => {
    recRef.current?.cancel();
    cleanup();
    setPhase('idle');
    setElapsed(0);
    setBytes(0);
    optsRef.current.notify('info', '녹화를 취소했습니다. 녹화된 내용은 저장되지 않았습니다.');
  }, [cleanup]);

  const handleTrackEnded = useCallback((kind: 'camera' | 'microphone') => {
    if (!recRef.current) return;
    const msg =
      kind === 'camera'
        ? '카메라 연결이 끊어져 녹화를 종료하고 지금까지의 내용을 저장했습니다.'
        : '마이크 연결이 끊어져 녹화를 종료하고 지금까지의 내용을 저장했습니다.';
    void stopRef.current(msg, true);
  }, []);

  // 언마운트 시 녹화 자원 정리
  useEffect(() => () => {
    pipeRef.current?.stop();
  }, []);

  return {
    phase,
    countdownLeft,
    elapsedMs,
    bytes,
    formats,
    activeFormat,
    plan,
    canPause: canPauseRecording(),
    lastResult,
    clearLastResult: () => setLastResult(null),
    start,
    stop,
    pause,
    resume,
    cancel,
    cancelCountdown,
    handleTrackEnded,
  };
}
