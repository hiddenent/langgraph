import { useEffect, useMemo, useState } from 'react';
import { ColorAdjust, buildColorMatrix, isNeutral, matrixToSvgValues } from '../core/colorMatrix';
import { FriendlyError } from '../core/devices';
import { formatDateTime, formatDuration } from '../core/format';
import type { Settings, StudioMode } from '../core/settings';
import type { TrackState } from '../hooks/useMediaSession';
import { GuideOverlay } from './GuideOverlay';
import { Histogram } from './Histogram';
import { Icon } from './Icon';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  mode: StudioMode;
  camera: TrackState;
  started: boolean;
  apiError: FriendlyError | null;
  /** 실제 적용할 화면 비율(가로/세로) */
  ratio: number;
  mirror: boolean;
  zoom: number;
  hardwareZoom: boolean;
  guides: Settings['guides'];
  color: ColorAdjust | null;
  overlayText: { timestamp: boolean; watermark: string; position: string; opacity: number } | null;
  countdown: number;
  recPhase: 'idle' | 'countdown' | 'recording' | 'paused' | 'finalizing';
  elapsedMs: number;
  limitSec: number;
  sequenceInfo: string | null;
  flashKey: number;
  onStart(): void;
  onRetryCamera(): void;
  onRescan(): void;
  onVideoSize(size: { w: number; h: number }): void;
  onZoom(z: number): void;
  maxZoom: number;
  minZoom: number;
  zoomStep: number;
}

export function PreviewStage(p: Props) {
  const { videoRef, camera } = p;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== camera.stream) {
      v.srcObject = camera.stream;
      if (camera.stream) void v.play().catch(() => undefined);
    }
  }, [camera.stream, videoRef]);

  // 모바일에서 앱 전환 후 돌아오면 미리보기 video 가 멈춰 있는 경우가 있어 다시 재생한다.
  useEffect(() => {
    const onVisible = () => {
      const v = videoRef.current;
      if (document.visibilityState === 'visible' && v && v.srcObject && v.paused) void v.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const report = () => p.onVideoSize({ w: v.videoWidth, h: v.videoHeight });
    v.addEventListener('loadedmetadata', report);
    v.addEventListener('resize', report);
    return () => {
      v.removeEventListener('loadedmetadata', report);
      v.removeEventListener('resize', report);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, p.onVideoSize]);

  const ratio = p.ratio;
  const colorOn = p.color && !isNeutral(p.color);
  const matrixValues = useMemo(() => (p.color && colorOn ? matrixToSvgValues(buildColorMatrix(p.color)) : ''), [p.color, colorOn]);
  const digitalScale = p.hardwareZoom ? 1 : p.zoom;
  const videoStyle: React.CSSProperties = {
    transform: `scale(${digitalScale}) scaleX(${p.mirror ? -1 : 1})`,
    filter: colorOn ? 'url(#hid-color-matrix)' : undefined,
  };

  const s = camera.settings;
  const recording = p.recPhase === 'recording' || p.recPhase === 'paused';
  const remaining = p.limitSec > 0 ? Math.max(0, p.limitSec * 1000 - p.elapsedMs) : null;

  return (
    <div className="stage">
      <div
        className={`stage__frame ${recording ? 'stage__frame--rec' : ''}`}
        style={{ aspectRatio: `${ratio}`, ['--ar' as string]: ratio } as React.CSSProperties}
        data-testid="preview-frame"
      >
        <video ref={videoRef} className="stage__video" style={videoStyle} autoPlay playsInline muted data-testid="preview-video" />
        {colorOn && (
          <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
            <filter id="hid-color-matrix" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={matrixValues} />
            </filter>
          </svg>
        )}
        {camera.status === 'live' && <GuideOverlay guides={p.guides} />}
        {camera.status === 'live' && p.guides.visible && p.guides.histogram && <Histogram videoRef={videoRef} />}

        {p.overlayText && camera.status === 'live' && (
          <div className={`stage__stamp stage__stamp--${p.overlayText.position}`} aria-hidden="true">
            {p.overlayText.watermark && <span style={{ opacity: p.overlayText.opacity }}>{p.overlayText.watermark}</span>}
            {p.overlayText.timestamp && <LiveClock />}
          </div>
        )}

        {recording && (
          <div className={`rec-badge ${p.recPhase === 'paused' ? 'rec-badge--paused' : ''}`} role="status" data-testid="rec-indicator">
            <span className="rec-badge__dot" aria-hidden="true" />
            <span>{p.recPhase === 'paused' ? '일시정지' : 'REC'}</span>
            <span className="rec-badge__time" data-testid="rec-elapsed">
              {formatDuration(p.elapsedMs)}
            </span>
            {remaining !== null && <span className="rec-badge__remain">남은 시간 {formatDuration(remaining)}</span>}
          </div>
        )}
        {p.sequenceInfo && <div className="rec-badge rec-badge--seq">{p.sequenceInfo}</div>}

        {p.countdown > 0 && (
          <div className="countdown" role="timer" aria-live="assertive" data-testid="countdown">
            <span key={p.countdown}>{p.countdown}</span>
            <small>Esc 로 취소</small>
          </div>
        )}
        {p.flashKey > 0 && <div key={p.flashKey} className="flash" aria-hidden="true" />}

        {camera.status === 'live' && s && (
          <div className="stage__chips">
            <span className="chip" data-testid="actual-resolution" title="카메라가 실제로 제공 중인 값(track.getSettings)">
              {s.width}×{s.height}
              {s.frameRate ? ` · ${Math.round(s.frameRate * 10) / 10}fps` : ''}
            </span>
            {camera.interrupted && <span className="chip chip--warn">영상 중단됨</span>}
            {p.zoom > 1 && <span className="chip">{p.hardwareZoom ? '카메라 줌' : '디지털 확대'} {p.zoom.toFixed(1)}×</span>}
            {colorOn && <span className="chip">미리보기 보정 적용</span>}
          </div>
        )}

        {camera.status === 'live' && (
          <div className="stage__zoom" role="group" aria-label="미리보기 확대/축소">
            <button
              type="button"
              className="icon-btn"
              onClick={() => p.onZoom(Math.max(p.minZoom, +(p.zoom - p.zoomStep).toFixed(2)))}
              disabled={p.zoom <= p.minZoom}
              aria-label="축소"
              title="축소"
            >
              <Icon name="zoomOut" />
            </button>
            <span className="stage__zoomval">{p.zoom.toFixed(1)}×</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => p.onZoom(Math.min(p.maxZoom, +(p.zoom + p.zoomStep).toFixed(2)))}
              disabled={p.zoom >= p.maxZoom}
              aria-label="확대"
              title="확대"
            >
              <Icon name="zoomIn" />
            </button>
          </div>
        )}

        {/* 상태 오버레이 */}
        {p.apiError ? (
          <div className="stage__overlay" role="alert">
            <Icon name="shield" size={40} />
            <h2>{p.apiError.title}</h2>
            <p>{p.apiError.detail}</p>
          </div>
        ) : !p.started && camera.status !== 'starting' && camera.status !== 'error' ? (
          <div className="stage__overlay stage__overlay--gate">
            <div className="brandmark" aria-hidden="true">
              H
            </div>
            <h2>카메라와 마이크를 시작하세요</h2>
            <p>
              촬영하려면 브라우저의 카메라·마이크 권한이 필요합니다. 촬영한 파일은 이 기기 안에서만 처리되며
              외부 서버로 전송되지 않습니다.
            </p>
            <button type="button" className="btn btn--primary btn--lg" onClick={p.onStart} data-testid="start-devices">
              <Icon name="camera" /> 카메라·마이크 시작
            </button>
          </div>
        ) : camera.status === 'starting' ? (
          <div className="stage__overlay" role="status">
            <div className="spinner" aria-hidden="true" />
            <p>카메라 연결 중… 브라우저 권한 요청 창이 보이면 '허용'을 눌러 주세요.</p>
          </div>
        ) : camera.status === 'error' || camera.status === 'disconnected' ? (
          <div className="stage__overlay stage__overlay--error" role="alert" data-testid="camera-error">
            <Icon name="alert" size={40} />
            <h2>{camera.error?.title ?? '카메라 오류'}</h2>
            <p>{camera.error?.detail}</p>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={p.onRetryCamera}>
                <Icon name="refresh" /> {camera.status === 'disconnected' ? '다시 연결' : '다시 시도'}
              </button>
              <button type="button" className="btn" onClick={p.onRescan}>
                장치 다시 찾기
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {camera.notice && camera.status === 'live' && (
        <p className="stage__notice" role="status">
          <Icon name="info" size={14} /> {camera.notice}
        </p>
      )}
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="stage__date">{formatDateTime(now)}</span>;
}
