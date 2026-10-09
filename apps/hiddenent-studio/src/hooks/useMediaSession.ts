// 카메라·마이크 스트림 수명 주기 관리.
//  - 사용자가 '시작'을 누르기 전에는 장치에 접근하지 않는다.
//  - 장치·설정 변경 시 기존 스트림을 먼저 종료한 뒤 새 스트림을 연결한다.
//  - 녹화 중(locked)에는 스트림을 다시 열지 않는다.
//  - 트랙 종료(장치 분리)를 감지해 상위에 알린다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceLists,
  FriendlyError,
  buildAudioConstraints,
  buildVideoConstraints,
  describeMediaError,
  listDevices,
  mediaApiAvailable,
  stopStream,
  trackCapabilities,
} from '../core/devices';
import type { Settings, StudioMode } from '../core/settings';

export type DeviceStatus = 'off' | 'starting' | 'live' | 'error' | 'disconnected';

export interface TrackState {
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  status: DeviceStatus;
  error: FriendlyError | null;
  settings: MediaTrackSettings | null;
  capabilities: MediaTrackCapabilities & Record<string, unknown>;
  /** 트랙이 운영체제/브라우저에 의해 일시적으로 음소거(프레임 없음)된 상태 */
  interrupted: boolean;
  notice: string | null;
}

const EMPTY: TrackState = {
  stream: null,
  track: null,
  status: 'off',
  error: null,
  settings: null,
  capabilities: {},
  interrupted: false,
  notice: null,
};

export interface MediaSession {
  started: boolean;
  camera: TrackState;
  mic: TrackState;
  devices: DeviceLists;
  labelsAvailable: boolean;
  apiError: FriendlyError | null;
  start(): Promise<void>;
  stopAll(): void;
  retryCamera(): void;
  retryMic(): void;
  refreshDevices(): Promise<void>;
  applyCameraConstraints(c: Record<string, unknown>): Promise<boolean>;
  refreshTrackInfo(): void;
}

interface Options {
  settings: Settings;
  mode: StudioMode;
  locked: boolean;
  onTrackEnded: (kind: 'camera' | 'microphone') => void;
}

function isOverconstrained(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError';
}

function isNotFound(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === 'NotFoundError' || n === 'DevicesNotFoundError';
}

export function useMediaSession({ settings, mode, locked, onTrackEnded }: Options): MediaSession {
  const [started, setStarted] = useState(false);
  const [camera, setCamera] = useState<TrackState>(EMPTY);
  const [mic, setMic] = useState<TrackState>(EMPTY);
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], microphones: [] });
  const apiError = useMemo(() => mediaApiAvailable(), []);

  const camRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const camSeq = useRef(0);
  const micSeq = useRef(0);
  const camKeys = useRef<Set<string>>(new Set());
  const micKeys = useRef<Set<string>>(new Set());
  const endedCb = useRef(onTrackEnded);
  endedCb.current = onTrackEnded;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const supported = useMemo<MediaTrackSupportedConstraints>(
    () => navigator.mediaDevices?.getSupportedConstraints?.() ?? {},
    [],
  );

  const modeSettings = mode === 'video' ? settings.video : settings.photo;
  const videoReq = useMemo(
    () => ({
      deviceId: settings.cameraId || undefined,
      facingMode: settings.cameraId ? undefined : settings.facing ?? undefined,
      resolutionId: modeSettings.resolutionId,
      frameRate: mode === 'video' ? settings.video.frameRate : 30,
      aspect: modeSettings.aspect,
    }),
    [settings.cameraId, settings.facing, modeSettings.resolutionId, modeSettings.aspect, mode, settings.video.frameRate],
  );
  const audioReq = useMemo(
    () => ({
      deviceId: settings.micId || undefined,
      echoCancellation: settings.audio.echoCancellation,
      noiseSuppression: settings.audio.noiseSuppression,
      autoGainControl: settings.audio.autoGainControl,
      channelCount: settings.audio.channelCount,
    }),
    [
      settings.micId,
      settings.audio.echoCancellation,
      settings.audio.noiseSuppression,
      settings.audio.autoGainControl,
      settings.audio.channelCount,
    ],
  );
  const micWanted = mode === 'video' || settings.ui.keepMicInPhoto;
  const camKey = JSON.stringify(videoReq);
  const micKey = JSON.stringify(audioReq);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listDevices());
    } catch {
      /* 장치 목록 조회 실패는 치명적이지 않다 */
    }
  }, []);

  const describeTrack = (track: MediaStreamTrack) => ({
    settings: track.getSettings(),
    capabilities: trackCapabilities(track),
  });

  const wireTrack = useCallback((track: MediaStreamTrack, kind: 'camera' | 'microphone') => {
    const set = kind === 'camera' ? setCamera : setMic;
    track.addEventListener('ended', () => {
      const ref = kind === 'camera' ? camRef : micRef;
      if (!ref.current || !ref.current.getTracks().includes(track)) return; // 의도적으로 교체된 트랙
      set((s) => ({
        ...s,
        status: 'disconnected',
        interrupted: false,
        error: {
          code: 'disconnected',
          title: kind === 'camera' ? '카메라 연결이 끊어졌습니다' : '마이크 연결이 끊어졌습니다',
          detail: '장치를 다시 연결한 뒤 ‘다시 연결’을 누르거나 다른 장치를 선택하세요.',
          retryable: true,
        },
      }));
      endedCb.current(kind);
      void refreshDevices();
    });
    track.addEventListener('mute', () => set((s) => ({ ...s, interrupted: true })));
    track.addEventListener('unmute', () => set((s) => ({ ...s, interrupted: false })));
  }, [refreshDevices]);

  const acquireCamera = useCallback(
    async (key: string, req: typeof videoReq) => {
      const seq = ++camSeq.current;
      // 시도 시작 시점에 키를 기록해 같은 조건으로 중복·자동 재시도하지 않게 한다.
      camKeys.current = new Set([key]);
      setCamera((s) => ({ ...s, status: 'starting', error: null, notice: null }));
      stopStream(camRef.current);
      camRef.current = null;
      let stream: MediaStream | null = null;
      let notice: string | null = null;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: buildVideoConstraints(req), audio: false });
        } catch (e) {
          if (isOverconstrained(e)) {
            // 해상도·프레임 조건을 빼고 장치만 지정해 다시 시도
            stream = await navigator.mediaDevices.getUserMedia({
              video: req.deviceId ? { deviceId: { exact: req.deviceId } } : true,
              audio: false,
            });
            notice = '요청한 해상도/프레임 레이트를 지원하지 않아 장치 기본값으로 연결했습니다.';
          } else if (isNotFound(e) && req.deviceId) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            notice = '선택한 카메라를 찾을 수 없어 기본 카메라로 연결했습니다.';
          } else {
            throw e;
          }
        }
      } catch (e) {
        if (seq !== camSeq.current) return;
        setCamera({ ...EMPTY, status: 'error', error: describeMediaError(e, 'camera') });
        return;
      }
      if (seq !== camSeq.current) {
        stopStream(stream);
        return;
      }
      const track = stream.getVideoTracks()[0];
      camRef.current = stream;
      wireTrack(track, 'camera');
      camKeys.current.add(JSON.stringify({ ...req, deviceId: track.getSettings().deviceId }));
      setCamera({ ...EMPTY, stream, track, status: 'live', notice, ...describeTrack(track) });
    },
    [wireTrack],
  );

  const acquireMic = useCallback(
    async (key: string, req: typeof audioReq) => {
      const seq = ++micSeq.current;
      micKeys.current = new Set([key]);
      setMic((s) => ({ ...s, status: 'starting', error: null, notice: null }));
      stopStream(micRef.current);
      micRef.current = null;
      let stream: MediaStream | null = null;
      let notice: string | null = null;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(req, supported), video: false });
        } catch (e) {
          if ((isNotFound(e) || isOverconstrained(e)) && req.deviceId) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            notice = '선택한 마이크를 열 수 없어 기본 마이크로 연결했습니다.';
          } else {
            throw e;
          }
        }
      } catch (e) {
        if (seq !== micSeq.current) return;
        setMic({ ...EMPTY, status: 'error', error: describeMediaError(e, 'microphone') });
        return;
      }
      if (seq !== micSeq.current) {
        stopStream(stream);
        return;
      }
      const track = stream.getAudioTracks()[0];
      track.enabled = !settingsRef.current.audio.muted;
      micRef.current = stream;
      wireTrack(track, 'microphone');
      micKeys.current.add(JSON.stringify({ ...req, deviceId: track.getSettings().deviceId }));
      setMic({ ...EMPTY, stream, track, status: 'live', notice, ...describeTrack(track) });
    },
    [supported, wireTrack],
  );

  const releaseMic = useCallback(() => {
    micSeq.current++;
    stopStream(micRef.current);
    micRef.current = null;
    micKeys.current = new Set();
    setMic(EMPTY);
  }, []);

  /** 최초 시작: 한 번의 권한 요청으로 카메라·마이크를 함께 연다. */
  const start = useCallback(async () => {
    if (apiError) return;
    const wantMic = micWanted;
    camSeq.current++;
    micSeq.current++;
    camKeys.current = new Set([camKey]);
    micKeys.current = wantMic ? new Set([micKey]) : new Set();
    setCamera((s) => ({ ...s, status: 'starting', error: null }));
    if (wantMic) setMic((s) => ({ ...s, status: 'starting', error: null }));
    try {
      const combined = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(videoReq),
        audio: wantMic ? buildAudioConstraints(audioReq, supported) : false,
      });
      const v = combined.getVideoTracks()[0];
      const a = combined.getAudioTracks()[0];
      const camStream = new MediaStream([v]);
      camRef.current = camStream;
      wireTrack(v, 'camera');
      camKeys.current.add(JSON.stringify({ ...videoReq, deviceId: v.getSettings().deviceId }));
      setCamera({ ...EMPTY, stream: camStream, track: v, status: 'live', ...describeTrack(v) });
      if (a) {
        a.enabled = !settingsRef.current.audio.muted;
        const micStream = new MediaStream([a]);
        micRef.current = micStream;
        wireTrack(a, 'microphone');
        micKeys.current.add(JSON.stringify({ ...audioReq, deviceId: a.getSettings().deviceId }));
        setMic({ ...EMPTY, stream: micStream, track: a, status: 'live', ...describeTrack(a) });
      }
    } catch {
      // 함께 열기에 실패하면 어느 쪽이 문제인지 알기 위해 각각 따로 시도한다.
      await acquireCamera(camKey, videoReq);
      if (wantMic) await acquireMic(micKey, audioReq);
    }
    // 시작 완료 후에 started 를 켜야 설정 변경 감시 effect 가 중복으로 장치를 열지 않는다.
    setStarted(true);
    await refreshDevices();
  }, [apiError, micWanted, videoReq, audioReq, supported, camKey, micKey, wireTrack, acquireCamera, acquireMic, refreshDevices]);

  const stopAll = useCallback(() => {
    camSeq.current++;
    micSeq.current++;
    stopStream(camRef.current);
    stopStream(micRef.current);
    camRef.current = null;
    micRef.current = null;
    camKeys.current = new Set();
    micKeys.current = new Set();
    setCamera(EMPTY);
    setMic(EMPTY);
    setStarted(false);
  }, []);

  // 설정 변경 → 카메라 재연결
  useEffect(() => {
    if (!started || locked) return;
    if (camKeys.current.has(camKey)) return;
    void acquireCamera(camKey, videoReq);
  }, [started, locked, camKey, videoReq, acquireCamera]);

  // 설정 변경 → 마이크 재연결 / 불필요 시 해제
  useEffect(() => {
    if (!started || locked) return;
    if (!micWanted) {
      if (micRef.current || mic.status !== 'off') releaseMic();
      return;
    }
    if (micKeys.current.has(micKey)) return;
    void acquireMic(micKey, audioReq);
  }, [started, locked, micKey, micWanted, audioReq, acquireMic, releaseMic, mic.status]);

  // 음소거는 스트림을 다시 열지 않고 녹음 트랙만 비활성화한다.
  useEffect(() => {
    const t = micRef.current?.getAudioTracks()[0];
    if (t) t.enabled = !settings.audio.muted;
  }, [settings.audio.muted, mic.track]);

  // 장치 연결/해제 감지
  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  // 페이지 종료 시 모든 트랙 정리
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (!e.persisted) {
        stopStream(camRef.current);
        stopStream(micRef.current);
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      stopStream(camRef.current);
      stopStream(micRef.current);
    };
  }, []);

  const retryCamera = useCallback(() => {
    if (!started) {
      void start();
      return;
    }
    void acquireCamera(camKey, videoReq);
  }, [started, start, acquireCamera, camKey, videoReq]);

  const retryMic = useCallback(() => {
    if (!started) {
      void start();
      return;
    }
    void acquireMic(micKey, audioReq);
  }, [started, start, acquireMic, micKey, audioReq]);

  const refreshTrackInfo = useCallback(() => {
    const v = camRef.current?.getVideoTracks()[0];
    if (v) setCamera((s) => (s.track === v ? { ...s, ...describeTrack(v) } : s));
    const a = micRef.current?.getAudioTracks()[0];
    if (a) setMic((s) => (s.track === a ? { ...s, ...describeTrack(a) } : s));
  }, []);

  const applyCameraConstraints = useCallback(
    async (c: Record<string, unknown>) => {
      const v = camRef.current?.getVideoTracks()[0];
      if (!v) return false;
      try {
        await v.applyConstraints({ advanced: [c as MediaTrackConstraintSet] });
        refreshTrackInfo();
        return true;
      } catch {
        refreshTrackInfo();
        return false;
      }
    },
    [refreshTrackInfo],
  );

  const labelsAvailable = devices.cameras.some((d) => d.hasLabel) || devices.microphones.some((d) => d.hasLabel);

  return {
    started,
    camera,
    mic,
    devices,
    labelsAvailable,
    apiError,
    start,
    stopAll,
    retryCamera,
    retryMic,
    refreshDevices,
    applyCameraConstraints,
    refreshTrackInfo,
  };
}
