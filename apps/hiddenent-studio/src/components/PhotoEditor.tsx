// 촬영 후 편집: 회전 + 자르기(드래그로 이동, 모서리로 크기 조절, 비율 고정 옵션).

import { useEffect, useRef, useState } from 'react';
import { CropRect, Rotation, editPhoto } from '../core/photo';
import type { MediaItem } from '../core/storage';
import { Icon } from './Icon';
import { Modal, Segmented } from './ui';

type Ratio = 'free' | '1:1' | '4:3' | '16:9' | '9:16' | '3:2';
const RATIO_VALUE: Record<Ratio, number | null> = { free: null, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 3 / 2 };

export function PhotoEditor({
  item,
  onCancel,
  onSave,
}: {
  item: MediaItem;
  onCancel(): void;
  onSave(result: { blob: Blob; width: number; height: number }): void;
}) {
  const [rotation, setRotation] = useState<Rotation>(0);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const [ratio, setRatio] = useState<Ratio>('free');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url] = useState(() => URL.createObjectURL(item.blob));
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; start: CropRect } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // 비율 변경 시 중앙 기준으로 자르기 영역을 맞춘다(이미지 픽셀 비율 고려).
  useEffect(() => {
    const r = RATIO_VALUE[ratio];
    if (!r) return;
    const imgRatio = item.width / item.height;
    const normRatio = r / imgRatio;
    let w = 1;
    let h = w / normRatio;
    if (h > 1) {
      h = 1;
      w = normRatio;
    }
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }, [ratio, item.width, item.height]);

  const onPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: crop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = boxRef.current;
    if (!d || !el) return;
    // 회전된 화면 좌표의 이동량을 원본(회전 전) 이미지 좌표로 되돌린다.
    const sx = e.clientX - d.sx;
    const sy = e.clientY - d.sy;
    const [rx, ry] = rotation === 90 ? [sy, -sx] : rotation === 180 ? [-sx, -sy] : rotation === 270 ? [-sy, sx] : [sx, sy];
    const dx = rx / el.offsetWidth;
    const dy = ry / el.offsetHeight;
    const s = d.start;
    if (d.mode === 'move') {
      setCrop({ ...s, x: Math.min(1 - s.w, Math.max(0, s.x + dx)), y: Math.min(1 - s.h, Math.max(0, s.y + dy)) });
    } else {
      let w = Math.min(1 - s.x, Math.max(0.05, s.w + dx));
      let h = Math.min(1 - s.y, Math.max(0.05, s.h + dy));
      const r = RATIO_VALUE[ratio];
      if (r) {
        const normRatio = r / (item.width / item.height);
        h = w / normRatio;
        if (s.y + h > 1) {
          h = 1 - s.y;
          w = h * normRatio;
        }
      }
      setCrop({ ...s, w, h });
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const nudge = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = map[e.key];
    if (!m) return;
    e.preventDefault();
    setCrop((c) => ({ ...c, x: Math.min(1 - c.w, Math.max(0, c.x + m[0])), y: Math.min(1 - c.h, Math.max(0, c.y + m[1])) }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const mime = item.mime.startsWith('image/') ? item.mime : 'image/jpeg';
      onSave(await editPhoto(item.blob, crop, rotation, mime, 0.92));
    } catch (e) {
      setError(e instanceof Error ? e.message : '편집 결과를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const outW = Math.round(crop.w * item.width);
  const outH = Math.round(crop.h * item.height);
  const rotated = rotation === 90 || rotation === 270;

  return (
    <Modal
      title="사진 편집 — 회전 · 자르기"
      onClose={onCancel}
      wide
      testId="photo-editor"
      footer={
        <>
          <span className="muted">
            결과 크기 {rotated ? outH : outW}×{rotated ? outW : outH}
          </span>
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy} data-testid="editor-save">
            <Icon name="check" /> {busy ? '처리 중…' : '적용'}
          </button>
        </>
      }
    >
      <div className="editor">
        <div className="editor__canvas">
          <div className="editor__rot" style={{ transform: `rotate(${rotation}deg)` }}>
            <div className="editor__box" ref={boxRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
              <img src={url} alt="편집 중인 사진" draggable={false} />
              <div
                className="editor__crop"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={(e) => onPointerDown(e, 'move')}
                tabIndex={0}
                role="slider"
                aria-label="자르기 영역(화살표 키로 이동)"
                aria-valuetext={`x ${Math.round(crop.x * 100)}%, y ${Math.round(crop.y * 100)}%`}
                onKeyDown={nudge}
              >
                <span className="editor__handle" onPointerDown={(e) => onPointerDown(e, 'resize')} aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
        <div className="editor__side">
          <Segmented<Ratio>
            label="자르기 비율"
            value={ratio}
            options={(Object.keys(RATIO_VALUE) as Ratio[]).map((r) => ({ value: r, label: r === 'free' ? '자유' : r }))}
            onChange={setRatio}
          />
          <div className="row">
            <button type="button" className="btn" onClick={() => setRotation((r) => (((r + 270) % 360) as Rotation))} data-testid="rotate-left">
              <Icon name="rotate" /> 왼쪽 90°
            </button>
            <button type="button" className="btn" onClick={() => setRotation((r) => (((r + 90) % 360) as Rotation))} data-testid="rotate-right">
              <Icon name="rotate" className="flip-x" /> 오른쪽 90°
            </button>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}>
            자르기 초기화
          </button>
          {error && (
            <p className="note note--error" role="alert">
              {error}
            </p>
          )}
          <p className="note">영역을 드래그해 이동하고, 오른쪽 아래 모서리를 끌어 크기를 조절합니다. 키보드: 영역 선택 후 화살표 키.</p>
        </div>
      </div>
    </Modal>
  );
}
