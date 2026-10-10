// 사용자 설정 모델과 기본값. localStorage 에 저장한다(미디어 데이터는 저장하지 않음).

import type { ColorAdjust } from './colorMatrix';
import type { AspectId } from './devices';
import type { Rotation, WatermarkPosition } from './photo';

export type StudioMode = 'video' | 'photo';
export type DriveMode = 'single' | 'burst' | 'interval';
export type VideoQuality = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'custom';

export interface Settings {
  cameraId: string;
  micId: string;
  facing: 'user' | 'environment' | null;
  video: {
    resolutionId: string;
    frameRate: number;
    aspect: AspectId;
    quality: VideoQuality;
    /** quality = custom 일 때 사용(bps) */
    customBitrate: number;
    format: string;
    includeAudio: boolean;
    timeLimitSec: number;
    countdown: number;
    mirrorPreview: boolean;
    mirrorFile: boolean;
    fileTemplate: string;
  };
  audio: {
    muted: boolean;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    channelCount: 1 | 2;
    bitrate: number;
    monitoring: boolean;
    peakHoldMs: number;
  };
  photo: {
    resolutionId: string;
    aspect: AspectId;
    useImageCapture: boolean;
    format: string;
    quality: number;
    timer: number;
    drive: DriveMode;
    burstCount: number;
    burstIntervalMs: number;
    intervalSec: number;
    intervalMax: number;
    mirrorPreview: boolean;
    mirrorFile: boolean;
    rotation: Rotation;
    color: ColorAdjust;
    timestamp: boolean;
    watermarkText: string;
    watermarkPosition: WatermarkPosition;
    watermarkOpacity: number;
    maxLongEdge: number;
    fileTemplate: string;
    shutterSound: boolean;
  };
  guides: {
    visible: boolean;
    crosshair: boolean;
    thirds: boolean;
    golden: boolean;
    safe: boolean;
    horizon: boolean;
    histogram: boolean;
  };
  zoom: number;
  library: { autoPersist: boolean };
  ui: { countdownSound: boolean; collapseWhileRecording: boolean; keepMicInPhoto: boolean; autoStart: boolean; autoOrient: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  cameraId: '',
  micId: '',
  facing: null,
  video: {
    resolutionId: '1080p',
    frameRate: 30,
    aspect: '16:9',
    quality: 'auto',
    customBitrate: 8_000_000,
    format: 'auto',
    includeAudio: true,
    timeLimitSec: 0,
    countdown: 0,
    mirrorPreview: false,
    mirrorFile: false,
    fileTemplate: 'Hiddenent_{type}_{date}_{time}',
  },
  audio: {
    muted: false,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
    bitrate: 128_000,
    monitoring: true,
    peakHoldMs: 1500,
  },
  photo: {
    resolutionId: '1080p',
    aspect: '16:9',
    useImageCapture: false,
    format: 'image/jpeg',
    quality: 0.92,
    timer: 0,
    drive: 'single',
    burstCount: 5,
    burstIntervalMs: 250,
    intervalSec: 5,
    intervalMax: 20,
    mirrorPreview: false,
    mirrorFile: false,
    rotation: 0,
    color: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, effect: 'none' },
    timestamp: false,
    watermarkText: '',
    watermarkPosition: 'bottom-right',
    watermarkOpacity: 0.7,
    maxLongEdge: 0,
    fileTemplate: 'Hiddenent_{type}_{date}_{time}_{seq}',
    shutterSound: true,
  },
  guides: { visible: true, crosshair: false, thirds: true, golden: false, safe: false, horizon: false, histogram: false },
  zoom: 1,
  library: { autoPersist: false },
  ui: { countdownSound: true, collapseWhileRecording: true, keepMicInPhoto: true, autoStart: false, autoOrient: true },
};

/** 품질 프리셋 → 비디오 비트레이트(bps). auto 는 브라우저 기본값(undefined). */
export function videoBitrateFor(quality: VideoQuality, custom: number, height: number): number | undefined {
  const scale = height >= 2000 ? 4 : height >= 1400 ? 2.2 : height >= 1000 ? 1 : height >= 700 ? 0.55 : 0.3;
  switch (quality) {
    case 'low':
      return Math.round(2_500_000 * scale);
    case 'medium':
      return Math.round(5_000_000 * scale);
    case 'high':
      return Math.round(8_000_000 * scale);
    case 'max':
      return Math.round(16_000_000 * scale);
    case 'custom':
      return custom;
    default:
      return undefined;
  }
}

const KEY = 'hiddenent-studio-settings-v1';

function merge<T>(base: T, patch: unknown): T {
  if (base === null) return (patch === undefined ? base : patch) as T;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return (patch === undefined || typeof patch !== typeof base ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (patch && typeof patch === 'object') {
    for (const k of Object.keys(out)) {
      out[k] = merge(out[k], (patch as Record<string, unknown>)[k]);
    }
  }
  return out as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return merge(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 무시 */
  }
}

export { merge as mergeSettings };
