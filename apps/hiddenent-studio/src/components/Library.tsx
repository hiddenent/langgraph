import { useMemo, useState } from 'react';
import { downloadBlob, zipBlobs } from '../core/download';
import { formatBytes, formatDateTime, formatDuration } from '../core/format';
import { indexedDbSupported, requestPersistence } from '../core/storage';
import { useStudio } from '../StudioContext';
import { Icon } from './Icon';
import { safeDownload } from './MediaViewer';
import { ConfirmDialog, Toggle } from './ui';

type Filter = 'all' | 'photo' | 'video';
type Sort = 'new' | 'old' | 'name' | 'size';

export function Library({ onOpen }: { onOpen(id: string): void }) {
  const { library, notify, settings, patch } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('new');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [zipping, setZipping] = useState(false);

  const items = useMemo(() => {
    const list = library.items.filter((i) => filter === 'all' || i.kind === filter);
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'old':
          return a.createdAt - b.createdAt;
        case 'name':
          return a.name.localeCompare(b.name, 'ko');
        case 'size':
          return b.size - a.size;
        default:
          return b.createdAt - a.createdAt;
      }
    });
    return sorted;
  }, [library.items, filter, sort]);

  const sel = items.filter((i) => selected.has(i.id));
  const allSelected = items.length > 0 && sel.length === items.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const downloadEach = async () => {
    // 브라우저가 연속 다운로드를 막지 않도록 약간의 간격을 둔다.
    for (const i of sel) {
      safeDownload(i, notify);
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = await zipBlobs(sel.map((i) => ({ name: i.name, blob: i.blob })));
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      downloadBlob(zip, `Hiddenent_${stamp}_${sel.length}files.zip`);
    } catch (e) {
      notify('error', `ZIP 파일을 만들지 못했습니다(메모리 부족 가능성): ${e instanceof Error ? e.message : ''} 개별 다운로드를 이용하세요.`);
    } finally {
      setZipping(false);
    }
  };

  const est = library.estimate;
  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const tempBytes = library.items.filter((i) => !i.persisted).reduce((s, i) => s + i.size, 0);

  return (
    <div className="library" data-testid="library">
      <div className="library__head">
        <div>
          <h2>촬영 파일 라이브러리</h2>
          <p className="muted">
            모든 파일은 이 브라우저 안에만 있습니다. <b>임시</b> 파일은 탭을 닫으면 사라지고, <b>로컬 저장</b> 파일은 브라우저
            저장소(IndexedDB)에 남습니다. 외부 서버로 업로드하지 않습니다.
          </p>
        </div>
        <div className="storage">
          <div className="storage__bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="브라우저 저장소 사용량">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="muted">
            {est ? `로컬 저장소 ${formatBytes(est.usage)} / 허용량 약 ${formatBytes(est.quota)}` : '저장 용량 정보를 확인할 수 없습니다'}
            {` · 임시(메모리) ${formatBytes(tempBytes)}`}
            {est?.persisted ? ' · 영구 보존 허용됨' : ''}
          </span>
          <div className="row">
            <Toggle
              label="새 촬영 파일을 자동으로 로컬 저장"
              checked={settings.library.autoPersist}
              disabled={!indexedDbSupported()}
              onChange={(x) => patch('library', { autoPersist: x })}
              testId="auto-persist"
            />
            {est && !est.persisted && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  const ok = await requestPersistence();
                  notify(ok ? 'success' : 'info', ok ? '브라우저가 저장소 영구 보존을 허용했습니다.' : '브라우저가 영구 보존 요청을 허용하지 않았습니다(저장 공간 부족 시 자동 정리될 수 있음).');
                  void library.refreshEstimate();
                }}
              >
                영구 보존 요청
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="library__toolbar" role="toolbar" aria-label="라이브러리 도구">
        <div className="seg" role="radiogroup" aria-label="종류 필터">
          {(
            [
              ['all', `전체 ${library.items.length}`],
              ['photo', `사진 ${library.items.filter((i) => i.kind === 'photo').length}`],
              ['video', `동영상 ${library.items.filter((i) => i.kind === 'video').length}`],
            ] as [Filter, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} className={`seg__btn ${filter === v ? 'seg__btn--on' : ''}`} onClick={() => setFilter(v)} data-testid={`filter-${v}`}>
              {l}
            </button>
          ))}
        </div>
        <label className="inline-field">
          정렬
          <select className="select select--sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="new">최신순</option>
            <option value="old">오래된순</option>
            <option value="name">이름순</option>
            <option value="size">큰 파일순</option>
          </select>
        </label>
        <label className="inline-field">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
            data-testid="select-all"
          />
          전체 선택
        </label>
        <span className="muted">{sel.length}개 선택</span>
        <div className="library__bulk">
          <button type="button" className="btn btn--sm" disabled={sel.length === 0} onClick={() => void downloadEach()} data-testid="bulk-download">
            <Icon name="download" size={16} /> 개별 다운로드
          </button>
          <button type="button" className="btn btn--sm" disabled={sel.length < 2 || zipping} onClick={() => void downloadZip()} data-testid="bulk-zip">
            <Icon name="download" size={16} /> {zipping ? 'ZIP 생성 중…' : 'ZIP 으로 받기'}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            disabled={sel.filter((i) => !i.persisted).length === 0 || !indexedDbSupported()}
            onClick={async () => {
              for (const i of sel) if (!i.persisted) await library.persist(i.id);
            }}
          >
            <Icon name="save" size={16} /> 브라우저에 보관
          </button>
          <button type="button" className="btn btn--sm btn--danger-ghost" disabled={sel.length === 0} onClick={() => setConfirm(true)} data-testid="bulk-delete">
            <Icon name="trash" size={16} /> 삭제
          </button>
        </div>
      </div>

      {library.loading ? (
        <p className="muted">로컬 저장소를 불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <Icon name="library" size={40} />
          <p>표시할 파일이 없습니다. 동영상 또는 사진 모드에서 촬영해 보세요.</p>
        </div>
      ) : (
        <ul className="cards">
          {items.map((i) => (
            <li key={i.id} className={`card ${selected.has(i.id) ? 'card--sel' : ''}`} data-testid="library-card">
              <label className="card__check">
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.name} 선택`} />
              </label>
              <button type="button" className="card__thumb" onClick={() => onOpen(i.id)} aria-label={`${i.name} 열기`}>
                {i.thumbnail ? <img src={i.thumbnail} alt="" loading="lazy" /> : <Icon name={i.kind === 'video' ? 'video' : 'photo'} size={32} />}
                {i.kind === 'video' && (
                  <span className="card__play">
                    <Icon name="play" size={16} /> {formatDuration(i.durationMs ?? 0)}
                  </span>
                )}
              </button>
              <div className="card__body">
                <b className="card__name" title={i.name}>
                  {i.name}
                </b>
                <div className="card__badges">
                  <span className="badge">{i.kind === 'video' ? '동영상' : '사진'}</span>
                  <span className={`badge ${i.persisted ? 'badge--ok' : 'badge--warn'}`}>{i.persisted ? '로컬 저장' : '임시(메모리)'}</span>
                </div>
                <span className="muted">
                  {i.width}×{i.height} · {formatBytes(i.size)}
                </span>
                <span className="muted">{formatDateTime(new Date(i.createdAt))}</span>
              </div>
              <button type="button" className="icon-btn card__dl" onClick={() => safeDownload(i, notify)} aria-label={`${i.name} 다운로드`} title="다운로드">
                <Icon name="download" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title="선택한 파일 삭제"
          message={
            <>
              선택한 {sel.length}개 파일을 삭제할까요?
              {sel.some((i) => i.persisted) && ' 로컬 저장소에 보관된 파일도 함께 삭제됩니다.'} 이 작업은 되돌릴 수 없습니다.
            </>
          }
          confirmLabel={`${sel.length}개 삭제`}
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void library.remove(sel.map((i) => i.id));
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
