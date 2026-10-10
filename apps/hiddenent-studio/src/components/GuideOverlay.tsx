import type { Settings } from '../core/settings';

/** 구도 가이드(삼분할, 황금비, 십자선, 안전 영역, 수평선). 저장 파일에는 포함되지 않는다. */
export function GuideOverlay({ guides }: { guides: Settings['guides'] }) {
  if (!guides.visible) return null;
  const line = { vectorEffect: 'non-scaling-stroke' as const };
  return (
    <svg className="guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-testid="guides">
      {guides.thirds && (
        <g className="guides__thirds" {...line}>
          <line x1="33.333" y1="0" x2="33.333" y2="100" style={line} />
          <line x1="66.667" y1="0" x2="66.667" y2="100" style={line} />
          <line x1="0" y1="33.333" x2="100" y2="33.333" style={line} />
          <line x1="0" y1="66.667" x2="100" y2="66.667" style={line} />
        </g>
      )}
      {guides.golden && (
        <g className="guides__golden">
          <line x1="38.197" y1="0" x2="38.197" y2="100" style={line} />
          <line x1="61.803" y1="0" x2="61.803" y2="100" style={line} />
          <line x1="0" y1="38.197" x2="100" y2="38.197" style={line} />
          <line x1="0" y1="61.803" x2="100" y2="61.803" style={line} />
        </g>
      )}
      {guides.safe && (
        <g className="guides__safe">
          <rect x="3.5" y="3.5" width="93" height="93" style={line} />
          <rect x="5" y="5" width="90" height="90" style={{ ...line, strokeDasharray: '4 3' }} />
        </g>
      )}
      {guides.horizon && (
        <g className="guides__horizon">
          <line x1="0" y1="50" x2="100" y2="50" style={line} />
          {[10, 20, 30, 40, 60, 70, 80, 90].map((x) => (
            <line key={x} x1={x} y1="48.5" x2={x} y2="51.5" style={line} />
          ))}
        </g>
      )}
      {guides.crosshair && (
        <g className="guides__cross">
          <line x1="47" y1="50" x2="53" y2="50" style={line} />
          <line x1="50" y1="46" x2="50" y2="54" style={line} />
        </g>
      )}
    </svg>
  );
}
