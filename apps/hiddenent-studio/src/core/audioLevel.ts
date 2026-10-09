// 오디오 레벨 계산(순수 함수). 값은 모두 dBFS(디지털 풀스케일 대비 상대 레벨)이며
// 하드웨어 입력 게인이나 음압(dB SPL)을 뜻하지 않는다.

/** 이 값보다 작은 진폭은 디지털 무음으로 취급한다(-120 dBFS). */
export const SILENCE_FLOOR = 1e-6;
/** 미터 표시 하한. */
export const METER_MIN_DB = -60;
/** 샘플 피크가 이 값 이상이면 클리핑으로 판단한다(약 -0.1 dBFS). */
export const CLIP_THRESHOLD = 0.989;
/** 이 레벨 미만이 지속되면 '무신호'로 표시한다. */
export const NO_SIGNAL_DB = -70;

export interface ChannelLevel {
  rms: number;
  peak: number;
  clipped: boolean;
}

export function measureChannel(samples: Float32Array): ChannelLevel {
  if (samples.length === 0) return { rms: 0, peak: 0, clipped: false };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / samples.length);
  return { rms, peak, clipped: peak >= CLIP_THRESHOLD };
}

/** 선형 진폭을 dBFS로 환산한다. 무음(0 또는 극소값)은 -Infinity. */
export function toDbfs(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= SILENCE_FLOOR) return -Infinity;
  return 20 * Math.log10(amplitude);
}

export function formatDbfs(db: number): string {
  if (!Number.isFinite(db)) return '-∞';
  if (db > 0) return `+${db.toFixed(1)}`;
  return db.toFixed(1);
}

export type LevelZone = 'silent' | 'low' | 'normal' | 'high' | 'clip';

/**
 * 레벨 구간 분류.
 *  - silent: -70 dBFS 미만(무신호)
 *  - low:    -70 ~ -40 dBFS(입력 낮음)
 *  - normal: -40 ~ -12 dBFS(적정)
 *  - high:   -12 ~ -3 dBFS(높음)
 *  - clip:   -3 dBFS 이상(클리핑 위험)
 */
export function classifyLevel(db: number): LevelZone {
  if (!Number.isFinite(db) || db < NO_SIGNAL_DB) return 'silent';
  if (db < -40) return 'low';
  if (db < -12) return 'normal';
  if (db < -3) return 'high';
  return 'clip';
}

export const ZONE_LABEL: Record<LevelZone, string> = {
  silent: '무신호',
  low: '입력 낮음',
  normal: '적정',
  high: '높음',
  clip: '클리핑 위험',
};

/** dB 값을 미터 막대 비율(0~1)로 변환. */
export function dbToMeterFraction(db: number, minDb = METER_MIN_DB): number {
  if (!Number.isFinite(db)) return 0;
  if (db >= 0) return 1;
  if (db <= minDb) return 0;
  return (db - minDb) / -minDb;
}

/**
 * 미터 탄도 특성: 빠른 상승(즉시), 느린 하강(dB/s), 피크 홀드.
 * 피크 홀드는 holdMs 동안 유지된 뒤 하강한다. holdMs가 Infinity면 초기화 전까지 유지.
 */
export class MeterBallistics {
  level = -Infinity;
  peakHold = -Infinity;
  maxPeak = -Infinity;
  clipLatched = false;
  private peakHoldAt = 0;

  constructor(
    public releaseDbPerSec = 24,
    public holdMs = 1500,
  ) {}

  update(rmsDb: number, peakDb: number, clipped: boolean, nowMs: number, dtMs: number): void {
    if (rmsDb >= this.level || !Number.isFinite(this.level)) {
      this.level = rmsDb;
    } else {
      const fallen = this.level - (this.releaseDbPerSec * dtMs) / 1000;
      this.level = Math.max(rmsDb, fallen);
      if (this.level < METER_MIN_DB - 20) this.level = rmsDb;
    }
    if (peakDb >= this.peakHold || !Number.isFinite(this.peakHold)) {
      this.peakHold = peakDb;
      this.peakHoldAt = nowMs;
    } else if (Number.isFinite(this.holdMs) && nowMs - this.peakHoldAt > this.holdMs) {
      const fallen = this.peakHold - (this.releaseDbPerSec * 1.5 * dtMs) / 1000;
      this.peakHold = Math.max(peakDb, fallen);
      if (this.peakHold < METER_MIN_DB - 20) this.peakHold = peakDb;
    }
    if (peakDb > this.maxPeak) this.maxPeak = peakDb;
    if (clipped) this.clipLatched = true;
  }

  resetPeak(): void {
    this.peakHold = -Infinity;
    this.maxPeak = -Infinity;
    this.clipLatched = false;
    this.peakHoldAt = 0;
  }
}

/**
 * 모노 입력 판별: 오른쪽 채널이 완전 무음인데 왼쪽 채널에 신호가 있으면
 * 모노 소스가 스테레오 분배기에서 업믹스된 경우로 보고 L/R을 동일하게 표시한다.
 */
export function looksMono(left: ChannelLevel, right: ChannelLevel): boolean {
  return right.peak === 0 && left.peak > SILENCE_FLOOR;
}
