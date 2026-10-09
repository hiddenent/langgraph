import { formatBytes, formatDuration } from '../core/format';
import { useStudio } from '../StudioContext';
import { Icon } from './Icon';

export function ControlBar({ onRequestCancel }: { onRequestCancel(): void }) {
  const { mode, recorder, photo, session, settings, patch } = useStudio();
  const camLive = session.camera.status === 'live';
  const muted = settings.audio.muted;

  const common = (
    <div className="ctrl__side">
      <button
        type="button"
        className={`btn btn--ghost ${muted ? 'btn--warn' : ''}`}
        onClick={() => patch('audio', { muted: !muted })}
        aria-pressed={muted}
        title="마이크 음소거 전환 (M)"
        data-testid="mute-button"
      >
        <Icon name={muted ? 'micOff' : 'mic'} /> {muted ? '음소거됨' : '마이크 켜짐'}
      </button>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => patch('guides', { visible: !settings.guides.visible })}
        aria-pressed={settings.guides.visible}
        title="구도 가이드 표시/숨기기 (G)"
      >
        <Icon name="grid" /> 가이드 {settings.guides.visible ? '숨기기' : '보기'}
      </button>
    </div>
  );

  if (mode === 'video') {
    const ph = recorder.phase;
    return (
      <div className="ctrl" role="toolbar" aria-label="녹화 제어">
        {common}
        <div className="ctrl__main">
          {ph === 'idle' && (
            <button
              type="button"
              className="shutter shutter--rec"
              onClick={() => void recorder.start()}
              disabled={!camLive || !recorder.activeFormat}
              aria-label="녹화 시작 (Space)"
              title={!recorder.activeFormat ? '지원되는 녹화 형식이 없습니다' : '녹화 시작 (Space)'}
              data-testid="record-start"
            >
              <span className="shutter__inner" />
            </button>
          )}
          {ph === 'countdown' && (
            <button type="button" className="btn btn--lg" onClick={recorder.cancelCountdown} data-testid="countdown-cancel">
              <Icon name="x" /> 카운트다운 취소 (Esc)
            </button>
          )}
          {(ph === 'recording' || ph === 'paused') && (
            <>
              <button
                type="button"
                className="btn btn--lg"
                onClick={ph === 'paused' ? recorder.resume : recorder.pause}
                disabled={!recorder.canPause}
                title={recorder.canPause ? (ph === 'paused' ? '녹화 재개' : '녹화 일시정지') : '이 브라우저는 녹화 일시정지를 지원하지 않습니다'}
                data-testid="record-pause"
              >
                <Icon name={ph === 'paused' ? 'play' : 'pause'} /> {ph === 'paused' ? '재개' : '일시정지'}
              </button>
              <button
                type="button"
                className="shutter shutter--stop"
                onClick={() => void recorder.stop()}
                aria-label="녹화 종료 및 저장 (Space)"
                title="녹화 종료 및 저장 (Space)"
                data-testid="record-stop"
              >
                <span className="shutter__inner" />
              </button>
              <button type="button" className="btn btn--lg btn--danger-ghost" onClick={onRequestCancel} title="녹화 취소(저장하지 않음)" data-testid="record-cancel">
                <Icon name="trash" /> 취소
              </button>
            </>
          )}
          {ph === 'finalizing' && (
            <span className="ctrl__status" role="status">
              <span className="spinner spinner--sm" aria-hidden="true" /> 파일 생성 중…
            </span>
          )}
        </div>
        <div className="ctrl__info" aria-live="polite">
          {ph === 'recording' || ph === 'paused' ? (
            <>
              <span className="mono">{formatDuration(recorder.elapsedMs)}</span>
              <span>{formatBytes(recorder.bytes)}</span>
            </>
          ) : (
            <span className="ctrl__fmt" title={recorder.activeFormat?.mimeType}>
              {recorder.activeFormat ? recorder.activeFormat.label : '녹화 형식 없음'}
            </span>
          )}
        </div>
      </div>
    );
  }

  const ph = photo.phase;
  const drive = settings.photo.drive;
  return (
    <div className="ctrl" role="toolbar" aria-label="사진 촬영 제어">
      {common}
      <div className="ctrl__main">
        {ph === 'idle' || ph === 'capturing' ? (
          <button
            type="button"
            className="shutter shutter--photo"
            onClick={() => void photo.capture()}
            disabled={!camLive || ph === 'capturing'}
            aria-label="사진 촬영 (Space)"
            title="사진 촬영 (Space)"
            data-testid="photo-shutter"
          >
            <span className="shutter__inner" />
          </button>
        ) : (
          <button type="button" className="btn btn--lg" onClick={photo.cancel} data-testid="photo-cancel">
            <Icon name="stop" /> {ph === 'countdown' ? '타이머 취소 (Esc)' : `연속 촬영 중지 (${photo.sequenceCount}장)`}
          </button>
        )}
      </div>
      <div className="ctrl__info">
        <span>
          {drive === 'single' ? '단일' : drive === 'burst' ? `버스트 ${settings.photo.burstCount}장` : `인터벌 ${settings.photo.intervalSec}초`}
          {settings.photo.timer ? ` · 타이머 ${settings.photo.timer}초` : ''}
        </span>
      </div>
    </div>
  );
}

export function ThumbStrip({ onOpen }: { onOpen(id: string): void }) {
  const { library, mode, setSection } = useStudio();
  const items = library.items.filter((i) => i.kind === mode).slice(0, 12);
  return (
    <div className="thumbs" aria-label="최근 촬영 파일">
      <div className="thumbs__list">
        {items.length === 0 && <span className="thumbs__empty">아직 촬영한 {mode === 'video' ? '동영상' : '사진'}이 없습니다.</span>}
        {items.map((i) => (
          <button key={i.id} type="button" className="thumb" onClick={() => onOpen(i.id)} title={`${i.name} 열기`} data-testid="thumb">
            {i.thumbnail ? <img src={i.thumbnail} alt="" /> : <Icon name={i.kind === 'video' ? 'video' : 'photo'} />}
            {i.kind === 'video' && <span className="thumb__dur">{formatDuration(i.durationMs ?? 0)}</span>}
            <span className={`thumb__flag ${i.persisted ? 'thumb__flag--saved' : ''}`} title={i.persisted ? '로컬 저장됨' : '임시(메모리)'} />
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--ghost" onClick={() => setSection('library')}>
        <Icon name="library" /> 라이브러리 ({library.items.length})
      </button>
    </div>
  );
}
