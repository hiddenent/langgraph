import { useEffect, useId, useMemo, useState } from 'react';
import { canShareFile } from '../core/mobile';
import { downloadBlob } from '../core/download';
import { formatBytes, formatDateTime, formatDuration, renameKeepingExtension } from '../core/format';
import type { MediaItem } from '../core/storage';
import { useStudio } from '../StudioContext';
import { CompareSlider } from './CompareSlider';
import { Icon } from './Icon';
import { PhotoEditor } from './PhotoEditor';
import { ConfirmDialog, Modal } from './ui';

export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function safeDownload(item: MediaItem, notify: (k: 'error', m: string) => void): void {
  try {
    downloadBlob(item.blob, item.name);
  } catch (e) {
    notify('error', `다운로드 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
  }
}

/** 모바일 공유 시트: 아이폰 '비디오/이미지 저장'(사진 앱), 안드로이드 갤러리·다른 앱으로 저장. 사용자 버튼으로만 실행. */
export function ShareButton({ item, small }: { item: MediaItem; small?: boolean }) {
  const { notify } = useStudio();
  const file = useMemo(() => new File([item.blob], item.name, { type: item.blob.type || item.mime }), [item.blob, item.name, item.mime]);
  if (!canShareFile(file)) return null;
  return (
    <button
      type="button"
      className={`btn ${small ? 'btn--sm' : ''}`}
      data-testid="share-button"
      title="휴대폰 공유 메뉴를 엽니다. '비디오 저장'·'이미지 저장'을 고르면 사진 앱(갤러리)에 저장됩니다."
      onClick={async () => {
        try {
          await navigator.share({ files: [file], title: item.name });
        } catch (e) {
          if ((e as { name?: string })?.name !== 'AbortError') notify('error', '공유 메뉴를 열지 못했습니다. 다운로드 버튼을 이용하세요.');
        }
      }}
    >
      <Icon name="save" size={small ? 16 : 18} /> 사진 앱 저장·공유
    </button>
  );
}

export function MediaViewer({ itemId, onClose }: { itemId: string; onClose(): void }) {
  const { library, notify } = useStudio();
  const item = library.items.find((i) => i.id === itemId) ?? null;
  const url = useObjectUrl(item?.blob ?? null);
  const [tab, setTab] = useState<'view' | 'compare'>('view');
  const [zoomed, setZoomed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const nameId = useId();

  if (!item) return null;
  const canCompare = Boolean(item.beforeThumb && item.afterThumb);

  const doRename = async () => {
    const n = renameKeepingExtension(item.name, newName.trim() || item.name);
    await library.rename(item.id, n);
    setRenaming(false);
    notify('success', `이름을 '${n}'(으)로 바꿨습니다.`);
  };

  return (
    <>
      <Modal
        title={item.name}
        onClose={onClose}
        wide
        testId="media-viewer"
        footer={
          <div className="viewer__actions">
            <button type="button" className="btn btn--primary" onClick={() => safeDownload(item, notify)} data-testid="viewer-download">
              <Icon name="download" /> 다운로드
            </button>
            <ShareButton item={item} />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setNewName(item.name.replace(/\.[^.]+$/, ''));
                setRenaming(true);
              }}
            >
              <Icon name="edit" /> 이름 변경
            </button>
            {item.persisted ? (
              <button type="button" className="btn" onClick={() => void library.unpersist(item.id)} title="로컬 저장소에서만 제거(현재 탭에는 남음)">
                <Icon name="hdd" /> 로컬 보관 해제
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => void library.persist(item.id)} data-testid="viewer-persist">
                <Icon name="save" /> 브라우저에 보관
              </button>
            )}
            {item.kind === 'photo' && (
              <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="viewer-edit">
                <Icon name="crop" /> 회전·자르기
              </button>
            )}
            <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" /> 삭제
            </button>
          </div>
        }
      >
        {canCompare && (
          <div className="seg seg--inline" role="tablist" aria-label="보기 방식">
            <button type="button" role="tab" aria-selected={tab === 'view'} className={`seg__btn ${tab === 'view' ? 'seg__btn--on' : ''}`} onClick={() => setTab('view')}>
              {item.kind === 'video' ? '재생' : '보기'}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'compare'} className={`seg__btn ${tab === 'compare' ? 'seg__btn--on' : ''}`} onClick={() => setTab('compare')} data-testid="viewer-compare">
              전후 비교
            </button>
          </div>
        )}
        <div className="viewer">
          <div className={`viewer__media ${zoomed ? 'viewer__media--zoom' : ''}`}>
            {tab === 'compare' && canCompare ? (
              <CompareSlider
                before={item.beforeThumb!}
                after={item.afterThumb!}
                beforeLabel={item.kind === 'video' ? '녹화 시작' : '보정 전'}
                afterLabel={item.kind === 'video' ? '녹화 종료' : '보정 후(저장본)'}
              />
            ) : url && item.kind === 'video' ? (
              <video
                src={url}
                controls
                playsInline
                data-testid="viewer-video"
                onError={() => setMediaError('이 브라우저에서 이 동영상 형식을 재생할 수 없습니다. 다운로드 후 다른 플레이어(VLC 등)로 열어 보세요.')}
              />
            ) : url ? (
              <button type="button" className="viewer__imgbtn" onClick={() => setZoomed(!zoomed)} title={zoomed ? '화면에 맞추기' : '원본 크기로 보기'}>
                <img src={url} alt={item.name} data-testid="viewer-image" />
              </button>
            ) : null}
            {mediaError && <p className="note note--error">{mediaError}</p>}
          </div>
          <dl className="kv viewer__info">
            <dt>종류</dt>
            <dd>{item.kind === 'video' ? '동영상' : '사진'}</dd>
            <dt>해상도</dt>
            <dd>
              {item.width}×{item.height}
            </dd>
            {item.kind === 'video' && (
              <>
                <dt>길이</dt>
                <dd>{formatDuration(item.durationMs ?? 0, true)}</dd>
              </>
            )}
            <dt>파일 크기</dt>
            <dd data-testid="viewer-size">{formatBytes(item.size)}</dd>
            <dt>촬영 일시</dt>
            <dd>{formatDateTime(new Date(item.createdAt))}</dd>
            <dt>보관 상태</dt>
            <dd>{item.persisted ? '브라우저 로컬 저장소(IndexedDB)에 저장됨' : '임시 — 현재 탭 메모리에만 있음(탭을 닫으면 사라짐)'}</dd>
            {Object.entries(item.meta).map(([k, v]) => (
              <div key={k} className="kv__row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Modal>
      {renaming && (
        <Modal
          title="이름 변경"
          onClose={() => setRenaming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRenaming(false)}>
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void doRename()} data-testid="rename-ok">
                변경
              </button>
            </>
          }
        >
          <label htmlFor={nameId} className="field__label">
            새 파일명(확장자는 유지됩니다)
          </label>
          <input
            id={nameId}
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doRename()}
            data-testid="rename-input"
          />
        </Modal>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="파일 삭제"
          message={
            <>
              <b>{item.name}</b> 을(를) 삭제할까요? {item.persisted ? '로컬 저장소에서도 삭제되며 ' : ''}되돌릴 수 없습니다.
            </>
          }
          confirmLabel="삭제"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void library.remove([item.id]);
            onClose();
          }}
        />
      )}
      {editing && item.kind === 'photo' && (
        <PhotoEditor
          item={item}
          onCancel={() => setEditing(false)}
          onSave={(r) => {
            setEditing(false);
            void library.replaceBlob(item.id, {
              blob: r.blob,
              size: r.blob.size,
              width: r.width,
              height: r.height,
              afterThumb: undefined,
              beforeThumb: undefined,
              meta: { ...item.meta, 편집: '회전·자르기 적용됨' },
            });
            notify('success', '편집을 적용했습니다.');
          }}
        />
      )}
    </>
  );
}

/** 촬영 직후 미리보기 카드: 다시 촬영 / 다운로드 / 편집 / 크게 보기 */
export function ReviewCard({ item, onClose, onOpen }: { item: MediaItem; onClose(): void; onOpen(): void }) {
  const { library, notify } = useStudio();
  const [confirmRetake, setConfirmRetake] = useState(false);
  return (
    <aside className="review" aria-label={item.kind === 'photo' ? '촬영한 사진' : '녹화한 동영상'} data-testid="review-card">
      <button type="button" className="review__thumb" onClick={onOpen} title="크게 보기">
        {item.thumbnail ? <img src={item.thumbnail} alt="방금 촬영한 미리보기" /> : <Icon name="video" />}
      </button>
      <div className="review__meta">
        <b title={item.name}>{item.name}</b>
        <span>
          {item.width}×{item.height} · {formatBytes(item.size)}
          {item.kind === 'video' ? ` · ${formatDuration(item.durationMs ?? 0)}` : ''}
        </span>
        <span className="muted">{item.persisted ? '로컬 저장됨' : '임시 보관(다운로드 또는 보관 필요)'}</span>
      </div>
      <div className="review__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => safeDownload(item, notify)} data-testid="review-download">
          <Icon name="download" size={16} /> 저장
        </button>
        <ShareButton item={item} small />
        <button type="button" className="btn btn--sm" onClick={onOpen}>
          <Icon name="eye" size={16} /> {item.kind === 'video' ? '재생' : '보기'}
        </button>
        <button type="button" className="btn btn--sm" onClick={() => setConfirmRetake(true)} data-testid="review-retake">
          <Icon name="refresh" size={16} /> 다시 촬영
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="미리보기 닫기">
          <Icon name="x" size={16} />
        </button>
      </div>
      {confirmRetake && (
        <ConfirmDialog
          title="다시 촬영"
          message="방금 촬영한 파일을 삭제하고 다시 촬영할까요?"
          confirmLabel="삭제하고 다시 촬영"
          danger
          onCancel={() => setConfirmRetake(false)}
          onConfirm={() => {
            setConfirmRetake(false);
            void library.remove([item.id]);
            onClose();
          }}
        />
      )}
    </aside>
  );
}
