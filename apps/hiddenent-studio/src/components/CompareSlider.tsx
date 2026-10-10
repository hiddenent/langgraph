import { useId, useState } from 'react';

/** 두 이미지를 슬라이더로 겹쳐 비교한다(전후 비교). */
export function CompareSlider({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const [pos, setPos] = useState(50);
  const id = useId();
  return (
    <div className="compare" data-testid="compare">
      <div className="compare__view">
        <img src={after} alt={afterLabel} />
        <div className="compare__before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={before} alt={beforeLabel} />
        </div>
        <div className="compare__line" style={{ left: `${pos}%` }} aria-hidden="true" />
        <span className="compare__tag compare__tag--l">{beforeLabel}</span>
        <span className="compare__tag compare__tag--r">{afterLabel}</span>
      </div>
      <label htmlFor={id} className="sr-only">
        비교 위치
      </label>
      <input id={id} type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
    </div>
  );
}
