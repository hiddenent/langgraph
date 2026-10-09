import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioMeter } from './components/AudioMeter';
import { ControlBar, ThumbStrip } from './components/ControlBar';
import { HelpPage } from './components/HelpPage';
import { Icon } from './components/Icon';
import { Library } from './components/Library';
import { MediaViewer, ReviewCard } from './components/MediaViewer';
import {
  AudioSettingsPanel,
  DevicePanel,
  GuidesPanel,
  HardwareControlsPanel,
  PhotoSettingsPanel,
  VideoSettingsPanel,
} from './components/Panels';
import { PreviewStage } from './components/PreviewStage';
import { ConfirmDialog, isModalOpen } from './components/ui';
import { queryPermission } from './core/devices';
import { Settings, StudioMode, loadSettings, saveSettings } from './core/settings';
import { disposeSound } from './core/sound';
import type { MediaItem } from './core/storage';
import { useAudioMeter } from './hooks/useAudioMeter';
import { useLibrary } from './hooks/useLibrary';
import { useMediaSession } from './hooks/useMediaSession';
import { usePhotoCapture } from './hooks/usePhotoCapture';
import { useShortcuts } from './hooks/useShortcuts';
import { useToasts } from './hooks/useToasts';
import { useVideoRecorder } from './hooks/useVideoRecorder';
import { Section, Studio, StudioContext } from './StudioContext';
import { SettingsPage } from './components/SettingsPage';

const NAV: { id: Section; label: string; icon: string; key?: string }[] = [
  { id: 'video', label: '동영상 촬영', icon: 'video', key: 'V' },
  { id: 'photo', label: '사진 촬영', icon: 'photo', key: 'P' },
  { id: 'library', label: '라이브러리', icon: 'library' },
  { id: 'settings', label: '장치·환경 설정', icon: 'settings' },
  { id: 'help', label: '도움말·단축키', icon: 'help' },
];

const SECTION_TITLE: Record<Section, string> = {
  video: '동영상 촬영',
  photo: '사진 촬영',
  library: '촬영 파일 라이브러리',
  settings: '장치 및 환경 설정',
  help: '도움말 및 단축키',
};

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return m;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [section, setSectionRaw] = useState<Section>('video');
  const [mode, setMode] = useState<StudioMode>('video');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [confirmCancelRec, setConfirmCancelRec] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toasts, notify, dismiss } = useToasts();
  const narrow = useMediaQuery('(max-width: 1100px)');

  useEffect(() => saveSettings(settings), [settings]);

  const update = useCallback((fn: (s: Settings) => Settings) => setSettings(fn), []);
  const patch = useCallback<Studio['patch']>((key, value) => setSettings((s) => ({ ...s, [key]: { ...s[key], ...value } })), []);

  const library = useLibrary(settings.library.autoPersist, (m) => notify('error', m));

  // 녹화기·촬영기는 세션보다 나중에 만들어지므로 트랙 종료 알림은 ref 로 연결한다.
  const trackEndedRef = useRef<(k: 'camera' | 'microphone') => void>(() => undefined);
  const lockedRef = useRef(false);
  // 녹화기는 세션 트랙에 의존하므로 잠금 상태는 state 로 한 번 더 전달한다.
  const [sessionLocked, setSessionLocked] = useState(false);
  const session = useMediaSession({
    settings,
    mode,
    locked: sessionLocked,
    onTrackEnded: (k) => trackEndedRef.current(k),
  });

  const caps = session.camera.capabilities as Record<string, { min?: number; max?: number; step?: number } | undefined>;
  const hwZoomCap = caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number' && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
  const hardwareZoom = hwZoomCap ? { min: hwZoomCap.min!, max: hwZoomCap.max!, step: hwZoomCap.step || (hwZoomCap.max! - hwZoomCap.min!) / 20 } : null;
  const digitalZoom = hardwareZoom ? 1 : Math.max(1, settings.zoom);

  const micLabel = session.mic.track?.label ?? '';
  const addItem = useCallback((item: MediaItem) => void library.add(item), [library]);

  const recorder = useVideoRecorder({
    settings,
    videoEl: videoRef,
    cameraTrack: session.camera.track,
    micTrack: session.mic.track,
    micLabel,
    digitalZoom,
    videoSize,
    onSaved: addItem,
    notify,
  });
  const photo = usePhotoCapture({
    settings,
    videoEl: videoRef,
    cameraTrack: session.camera.track,
    digitalZoom,
    onSaved: addItem,
    notify,
  });
  const meter = useAudioMeter(session.mic.track, settings.audio.monitoring && session.mic.status === 'live');

  const recording = recorder.phase === 'recording' || recorder.phase === 'paused' || recorder.phase === 'finalizing';
  const locked = recorder.phase !== 'idle' || photo.phase !== 'idle';
  lockedRef.current = locked;
  useEffect(() => setSessionLocked(locked), [locked]);

  trackEndedRef.current = (kind) => {
    if (recording) recorder.handleTrackEnded(kind);
    else notify('warning', kind === 'camera' ? '카메라 연결이 끊어졌습니다. 장치를 확인하세요.' : '마이크 연결이 끊어졌습니다. 장치를 확인하세요.');
    if (photo.phase !== 'idle') photo.cancel();
  };

  const setSection = useCallback(
    (s: Section) => {
      if (lockedRef.current && s !== section) {
        notify('warning', '녹화·촬영 중에는 다른 메뉴로 이동할 수 없습니다. 먼저 녹화를 종료하세요.');
        return;
      }
      setSectionRaw(s);
      if (s === 'video' || s === 'photo') setMode(s);
    },
    [section, notify],
  );

  const setZoom = useCallback(
    (z: number) => {
      if (hardwareZoom) {
        void session.applyCameraConstraints({ zoom: z }).then((ok) => {
          if (!ok) notify('warning', '카메라가 줌 변경을 거부했습니다.');
        });
      }
      setSettings((s) => ({ ...s, zoom: z }));
    },
    [hardwareZoom, session, notify],
  );

  // 카메라가 바뀌면 확대 배율을 초기화
  const camId = session.camera.settings?.deviceId;
  useEffect(() => {
    setSettings((s) => (s.zoom === 1 ? s : { ...s, zoom: hardwareZoom ? hardwareZoom.min : 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camId]);

  const switchCamera = useCallback(() => {
    const cams = session.devices.cameras;
    const facing = session.camera.settings?.facingMode;
    if (cams.length <= 1) {
      notify('info', '전환할 다른 카메라가 없습니다.');
      return;
    }
    if (facing === 'user' || facing === 'environment') {
      setSettings((s) => ({ ...s, cameraId: '', facing: facing === 'user' ? 'environment' : 'user' }));
    } else {
      const cur = session.camera.settings?.deviceId;
      const idx = cams.findIndex((c) => c.deviceId === cur);
      const next = cams[(idx + 1) % cams.length];
      setSettings((s) => ({ ...s, cameraId: next.deviceId, facing: null }));
    }
  }, [session.devices.cameras, session.camera.settings, notify]);

  // 권한이 이미 있으면(설정 시) 자동 연결
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !settings.ui.autoStart) return;
    autoStarted.current = true;
    void (async () => {
      const [c, m] = await Promise.all([queryPermission('camera'), queryPermission('microphone')]);
      if (c === 'granted' && (m === 'granted' || mode === 'photo')) void session.start();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 페이지 이탈 경고(녹화 중이거나 저장하지 않은 임시 파일이 있을 때)
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (recording || library.unsavedCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [recording, library.unsavedCount]);

  // 탭 비활성화 감지
  const hiddenWhileRec = useRef(false);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && recording) hiddenWhileRec.current = true;
      if (!document.hidden && hiddenWhileRec.current) {
        hiddenWhileRec.current = false;
        notify(
          'warning',
          recorder.plan.pipeline === 'canvas'
            ? '탭이 백그라운드에 있는 동안 캔버스 처리 녹화의 영상 프레임이 멈췄을 수 있습니다. 녹화 중에는 이 탭을 앞에 두세요.'
            : '탭이 백그라운드에 있었습니다. 일부 모바일 브라우저는 백그라운드에서 카메라를 중단할 수 있습니다.',
        );
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [recording, recorder.plan.pipeline, notify]);

  // 화면 크기·방향 변경 시 실제 트랙 값 갱신
  useEffect(() => {
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => session.refreshTrackInfo(), 300);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [session]);

  useEffect(() => () => disposeSound(), []);

  // 촬영 직후 미리보기 카드
  const [reviewId, setReviewId] = useState<string | null>(null);
  useEffect(() => {
    if (photo.lastShot) setReviewId(photo.lastShot.id);
  }, [photo.lastShot]);
  useEffect(() => {
    if (recorder.lastResult) setReviewId(recorder.lastResult.id);
  }, [recorder.lastResult]);
  const reviewItem = library.items.find((i) => i.id === reviewId && i.kind === mode) ?? null;

  useShortcuts(
    {
      space: () => {
        if (isModalOpen()) return;
        if (section === 'video') {
          if (recorder.phase === 'idle') {
            if (session.camera.status === 'live') void recorder.start();
          } else if (recorder.phase === 'recording' || recorder.phase === 'paused') void recorder.stop();
        } else if (section === 'photo') {
          if (photo.phase === 'idle') {
            if (session.camera.status === 'live') void photo.capture();
          } else if (photo.phase === 'sequence') photo.cancel();
        }
      },
      v: () => !isModalOpen() && setSection('video'),
      p: () => !isModalOpen() && setSection('photo'),
      m: () => {
        if (isModalOpen()) return;
        const next = !settings.audio.muted;
        patch('audio', { muted: next });
        notify('info', next ? '마이크 음소거됨 (녹음에 무음 기록)' : '마이크 음소거 해제');
      },
      g: () => !isModalOpen() && patch('guides', { visible: !settings.guides.visible }),
      escape: () => {
        if (isModalOpen()) return;
        if (recorder.phase === 'countdown') recorder.cancelCountdown();
        else if (photo.phase === 'countdown' || photo.phase === 'sequence') photo.cancel();
        else if (recorder.phase === 'recording' || recorder.phase === 'paused') setConfirmCancelRec(true);
        else if (reviewItem) setReviewId(null);
      },
    },
    true,
  );

  const studio: Studio = useMemo(
    () => ({
      settings,
      update,
      patch,
      section,
      setSection,
      mode,
      session,
      meter,
      recorder,
      photo,
      library,
      notify,
      locked,
      switchCamera,
      hardwareZoom,
      setZoom,
      videoRef,
    }),
    [settings, update, patch, section, setSection, mode, session, meter, recorder, photo, library, notify, locked, switchCamera, hardwareZoom, setZoom],
  );

  const inStudio = section === 'video' || section === 'photo';
  const collapse = recording && settings.ui.collapseWhileRecording;
  const showLeft = leftOpen && !collapse;
  const showRight = rightOpen && !collapse && !narrow;
  const meterInRight = mode === 'video' && showRight;
  const camLive = session.camera.status === 'live';
  const micLive = session.mic.status === 'live';
  const modeSettings = mode === 'video' ? settings.video : settings.photo;

  const meterEl = (
    <AudioMeter
      handle={meter}
      micStatus={session.mic.status}
      micLabel={micLabel}
      muted={settings.audio.muted}
      monitoring={settings.audio.monitoring}
      peakHoldMs={settings.audio.peakHoldMs}
      channelCount={session.mic.settings?.channelCount}
      trackSampleRate={session.mic.settings?.sampleRate}
      onToggleMonitoring={() => patch('audio', { monitoring: !settings.audio.monitoring })}
      onToggleMute={() => patch('audio', { muted: !settings.audio.muted })}
      compact={!meterInRight}
    />
  );

  return (
    <StudioContext.Provider value={studio}>
      <div className="app" data-section={section}>
        <a href="#main" className="skip">
          본문으로 건너뛰기
        </a>
        <header className="topbar">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              H
            </span>
            <span className="brand__text">
              <b>Hiddenent</b>
              <small>Video &amp; Photo Studio</small>
            </span>
          </div>
          <div className="topbar__mode" aria-live="polite">
            <Icon name={NAV.find((n) => n.id === section)?.icon ?? 'video'} size={16} />
            {SECTION_TITLE[section]}
          </div>
          <div className="topbar__status" aria-label="장치 상태">
            {recording && (
              <span className="live live--rec" data-testid="top-rec">
                <span className="live__dot" /> {recorder.phase === 'paused' ? '녹화 일시정지' : '녹화 중'}
              </span>
            )}
            <span className={`live ${camLive ? 'live--on' : ''}`} data-testid="cam-indicator" title={camLive ? '카메라 사용 중' : '카메라 꺼짐'}>
              <span className="live__dot" />
              <Icon name="camera" size={14} /> {camLive ? '카메라 사용 중' : '카메라 꺼짐'}
            </span>
            <span className={`live ${micLive ? (settings.audio.muted ? 'live--muted' : 'live--on') : ''}`} data-testid="mic-indicator">
              <span className="live__dot" />
              <Icon name={settings.audio.muted ? 'micOff' : 'mic'} size={14} /> {micLive ? (settings.audio.muted ? '마이크 음소거' : '마이크 사용 중') : '마이크 꺼짐'}
            </span>
          </div>
          <div className="topbar__actions">
            {session.started && (
              <button type="button" className="icon-btn" onClick={session.stopAll} disabled={locked} title="카메라·마이크 사용 종료" aria-label="카메라·마이크 사용 종료">
                <Icon name="power" />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => setSection('settings')} title="장치 및 환경 설정" aria-label="장치 및 환경 설정">
              <Icon name="settings" />
            </button>
          </div>
        </header>

        <div className="shell">
          <nav className="nav" aria-label="주 메뉴">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`nav__item ${section === n.id ? 'nav__item--on' : ''}`}
                aria-current={section === n.id ? 'page' : undefined}
                onClick={() => setSection(n.id)}
                title={n.key ? `${n.label} (${n.key})` : n.label}
                data-testid={`nav-${n.id}`}
              >
                <Icon name={n.icon} size={20} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>

          <main id="main" className="main">
            <div className={`studio ${showLeft ? '' : 'studio--noleft'} ${showRight ? '' : 'studio--noright'}`} hidden={!inStudio}>
              <aside className="side side--left" hidden={!showLeft} aria-label={`${mode === 'video' ? '동영상' : '사진'} 촬영 설정`}>
                {mode === 'video' ? <VideoSettingsPanel /> : <PhotoSettingsPanel />}
                <GuidesPanel />
              </aside>

              <section className="center" aria-label="미리보기 및 촬영">
                <div className="center__bar">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={showLeft} disabled={collapse}>
                    <Icon name="chevronLeft" size={14} /> 촬영 설정 {showLeft ? '접기' : '펼치기'}
                  </button>
                  {collapse && <span className="muted">녹화 중 — 설정 패널을 접었습니다</span>}
                  {!narrow && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRightOpen(!rightOpen)} aria-expanded={showRight} disabled={collapse}>
                      세부 설정 {showRight ? '접기' : '펼치기'} <Icon name="chevronRight" size={14} />
                    </button>
                  )}
                </div>
                <PreviewStage
                  videoRef={videoRef}
                  mode={mode}
                  camera={session.camera}
                  started={session.started}
                  apiError={session.apiError}
                  aspect={modeSettings.aspect}
                  mirror={modeSettings.mirrorPreview}
                  zoom={settings.zoom}
                  hardwareZoom={Boolean(hardwareZoom)}
                  guides={settings.guides}
                  color={mode === 'photo' ? settings.photo.color : null}
                  overlayText={
                    mode === 'photo' && (settings.photo.timestamp || settings.photo.watermarkText)
                      ? {
                          timestamp: settings.photo.timestamp,
                          watermark: settings.photo.watermarkText,
                          position: settings.photo.watermarkPosition,
                          opacity: settings.photo.watermarkOpacity,
                        }
                      : null
                  }
                  countdown={mode === 'video' ? (recorder.phase === 'countdown' ? recorder.countdownLeft : 0) : photo.phase === 'countdown' ? photo.countdownLeft : 0}
                  recPhase={mode === 'video' ? recorder.phase : 'idle'}
                  elapsedMs={recorder.elapsedMs}
                  limitSec={settings.video.timeLimitSec}
                  sequenceInfo={mode === 'photo' && photo.phase === 'sequence' ? `연속 촬영 중 · ${photo.sequenceCount}장` : null}
                  flashKey={mode === 'photo' ? photo.flashKey : 0}
                  onStart={() => void session.start()}
                  onRetryCamera={session.retryCamera}
                  onRescan={() => void session.refreshDevices()}
                  onVideoSize={setVideoSize}
                  onZoom={setZoom}
                  minZoom={hardwareZoom ? hardwareZoom.min : 1}
                  maxZoom={hardwareZoom ? hardwareZoom.max : 4}
                  zoomStep={hardwareZoom ? hardwareZoom.step : 0.25}
                />
                {mode === 'video' && !meterInRight && meterEl}
                {reviewItem && (
                  <ReviewCard item={reviewItem} onClose={() => setReviewId(null)} onOpen={() => setViewerId(reviewItem.id)} />
                )}
                <ControlBar onRequestCancel={() => setConfirmCancelRec(true)} />
                <ThumbStrip onOpen={setViewerId} />
                {narrow && (
                  <div className="center__more">
                    <DevicePanel />
                    {mode === 'video' && <AudioSettingsPanel />}
                    <HardwareControlsPanel />
                  </div>
                )}
              </section>

              {!narrow && (
                <aside className="side side--right" hidden={!showRight} aria-label="세부 설정 및 오디오 모니터링">
                  {meterInRight && meterEl}
                  <DevicePanel />
                  {mode === 'video' && <AudioSettingsPanel />}
                  <HardwareControlsPanel />
                </aside>
              )}
            </div>

            {section === 'library' && <Library onOpen={setViewerId} />}
            {section === 'settings' && <SettingsPage />}
            {section === 'help' && <HelpPage />}
          </main>
        </div>

        <footer className="footer">
          <span>
            Powered by <b>Hiddenent</b>
          </span>
          <span className="muted">미디어는 이 기기 밖으로 전송되지 않습니다</span>
        </footer>

        <div className="toasts" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid="toast">
              <Icon name={t.kind === 'error' || t.kind === 'warning' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
              <span>{t.message}</span>
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => dismiss(t.id)} aria-label="알림 닫기">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>

        {viewerId && <MediaViewer itemId={viewerId} onClose={() => setViewerId(null)} />}
        {confirmCancelRec && (
          <ConfirmDialog
            title="녹화 취소"
            message="녹화를 취소하면 지금까지 녹화한 내용이 저장되지 않고 삭제됩니다. 저장하려면 '돌아가기' 후 정지 버튼을 누르세요."
            confirmLabel="저장하지 않고 취소"
            danger
            onCancel={() => setConfirmCancelRec(false)}
            onConfirm={() => {
              setConfirmCancelRec(false);
              recorder.cancel();
            }}
          />
        )}
      </div>
    </StudioContext.Provider>
  );
}
