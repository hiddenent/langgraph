// 색 보정을 하나의 4x5 색 행렬로 합성한다.
// 미리보기는 같은 행렬을 SVG feColorMatrix 로, 저장 이미지는 픽셀 연산으로 적용하므로
// 화면에서 보이는 보정과 저장 결과가 일치한다.

export type ColorEffect = 'none' | 'mono' | 'sepia' | 'cool' | 'warm' | 'vivid';

export interface ColorAdjust {
  /** -100 ~ 100 */
  brightness: number;
  contrast: number;
  saturation: number;
  /** -100(차갑게) ~ 100(따뜻하게) */
  temperature: number;
  effect: ColorEffect;
}

export const NEUTRAL_ADJUST: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, effect: 'none' };

export function isNeutral(a: ColorAdjust): boolean {
  return a.brightness === 0 && a.contrast === 0 && a.saturation === 0 && a.temperature === 0 && a.effect === 'none';
}

/** 행렬 = 4행 x 5열(R,G,B,A,offset). offset 은 0~1 스케일. */
export type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** a 다음에 b 를 적용한 행렬(b·a). */
export function compose(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += b[r * 5 + k] * a[k * 5 + c];
      if (c === 4) v += b[r * 5 + 4];
      out[r * 5 + c] = v;
    }
  }
  return out;
}

function saturationMatrix(s: number): Matrix {
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;
  return [
    lr + (1 - lr) * s, lg - lg * s, lb - lb * s, 0, 0,
    lr - lr * s, lg + (1 - lg) * s, lb - lb * s, 0, 0,
    lr - lr * s, lg - lg * s, lb + (1 - lb) * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

const SEPIA: Matrix = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];

function scaleMatrix(r: number, g: number, b: number): Matrix {
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

export function buildColorMatrix(a: ColorAdjust): Matrix {
  let m = IDENTITY.slice();
  if (a.brightness) {
    const k = 1 + a.brightness / 100;
    m = compose(m, scaleMatrix(k, k, k));
  }
  if (a.contrast) {
    const c = 1 + a.contrast / 100;
    const off = 0.5 * (1 - c);
    m = compose(m, [c, 0, 0, 0, off, 0, c, 0, 0, off, 0, 0, c, 0, off, 0, 0, 0, 1, 0]);
  }
  if (a.saturation) {
    m = compose(m, saturationMatrix(1 + a.saturation / 100));
  }
  if (a.temperature) {
    const t = a.temperature / 100;
    m = compose(m, scaleMatrix(1 + 0.18 * t, 1 + 0.03 * t, 1 - 0.18 * t));
  }
  switch (a.effect) {
    case 'mono':
      m = compose(m, saturationMatrix(0));
      break;
    case 'sepia':
      m = compose(m, SEPIA);
      break;
    case 'cool':
      m = compose(m, scaleMatrix(0.9, 1.0, 1.15));
      break;
    case 'warm':
      m = compose(m, scaleMatrix(1.12, 1.02, 0.85));
      break;
    case 'vivid':
      m = compose(m, saturationMatrix(1.45));
      break;
    default:
      break;
  }
  return m;
}

export function matrixToSvgValues(m: Matrix): string {
  return m.map((v) => (Math.abs(v) < 1e-6 ? 0 : Number(v.toFixed(5)))).join(' ');
}

/** ImageData(RGBA, 0~255)에 행렬을 적용한다. */
export function applyMatrix(data: Uint8ClampedArray, m: Matrix): void {
  const [a0, a1, a2, , a4, b0, b1, b2, , b4, c0, c1, c2, , c4] = m;
  const o0 = a4 * 255;
  const o1 = b4 * 255;
  const o2 = c4 * 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = a0 * r + a1 * g + a2 * b + o0;
    data[i + 1] = b0 * r + b1 * g + b2 * b + o1;
    data[i + 2] = c0 * r + c1 * g + c2 * b + o2;
  }
}

export const EFFECT_LABELS: Record<ColorEffect, string> = {
  none: '없음',
  mono: '흑백',
  sepia: '세피아',
  cool: '차가운 톤',
  warm: '따뜻한 톤',
  vivid: '선명하게',
};
