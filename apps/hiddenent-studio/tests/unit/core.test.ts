import { describe, expect, it } from 'vitest';
import {
  MeterBallistics,
  classifyLevel,
  dbToMeterFraction,
  formatDbfs,
  looksMono,
  measureChannel,
  toDbfs,
} from '../../src/core/audioLevel';
import { applyMatrix, buildColorMatrix, compose, matrixToSvgValues } from '../../src/core/colorMatrix';
import { extensionForMime, getSupportedFormats, pickFormat } from '../../src/core/codecs';
import { buildAudioConstraints, buildVideoConstraints, describeMediaError } from '../../src/core/devices';
import { buildFileName, formatBytes, formatDuration, renameKeepingExtension, sanitizeFileName } from '../../src/core/format';
import { centerCrop, fitLongEdge } from '../../src/core/photo';
import { DEFAULT_SETTINGS, mergeSettings, videoBitrateFor } from '../../src/core/settings';

describe('audio level (dBFS)', () => {
  it('full-scale sine RMS is about -3 dBFS and peak 0 dBFS', () => {
    const n = 4800;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
    const m = measureChannel(s);
    expect(toDbfs(m.rms)).toBeCloseTo(-3.01, 1);
    expect(toDbfs(m.peak)).toBeCloseTo(0, 1);
    expect(m.clipped).toBe(true);
  });

  it('half amplitude is -6 dBFS', () => {
    expect(toDbfs(0.5)).toBeCloseTo(-6.02, 2);
  });

  it('digital silence is -Infinity and shown as -∞, not a number', () => {
    const m = measureChannel(new Float32Array(1024));
    expect(m.rms).toBe(0);
    expect(toDbfs(m.rms)).toBe(-Infinity);
    expect(formatDbfs(-Infinity)).toBe('-∞');
    expect(toDbfs(1e-9)).toBe(-Infinity);
    expect(classifyLevel(-Infinity)).toBe('silent');
  });

  it('classifies zones', () => {
    expect(classifyLevel(-80)).toBe('silent');
    expect(classifyLevel(-50)).toBe('low');
    expect(classifyLevel(-20)).toBe('normal');
    expect(classifyLevel(-6)).toBe('high');
    expect(classifyLevel(-1)).toBe('clip');
  });

  it('maps dB to meter fraction', () => {
    expect(dbToMeterFraction(-60)).toBe(0);
    expect(dbToMeterFraction(0)).toBe(1);
    expect(dbToMeterFraction(-30)).toBeCloseTo(0.5);
    expect(dbToMeterFraction(-Infinity)).toBe(0);
  });

  it('ballistics: instant attack, slow release, peak hold, reset', () => {
    const b = new MeterBallistics(20, 1000);
    b.update(-10, -10, false, 0, 16);
    expect(b.level).toBe(-10);
    b.update(-60, -60, false, 100, 100);
    expect(b.level).toBeCloseTo(-12, 5); // 20 dB/s * 0.1 s
    expect(b.peakHold).toBe(-10); // 유지 중
    b.update(-60, -60, false, 1200, 100);
    expect(b.peakHold).toBeLessThan(-10); // 홀드 시간 경과 후 하강
    expect(b.maxPeak).toBe(-10);
    b.update(-1, -0.01, true, 1300, 16);
    expect(b.clipLatched).toBe(true);
    b.resetPeak();
    expect(b.maxPeak).toBe(-Infinity);
    expect(b.clipLatched).toBe(false);
  });

  it('detects mono upmix (right channel exactly silent)', () => {
    expect(looksMono({ rms: 0.1, peak: 0.2, clipped: false }, { rms: 0, peak: 0, clipped: false })).toBe(true);
    expect(looksMono({ rms: 0.1, peak: 0.2, clipped: false }, { rms: 0.01, peak: 0.02, clipped: false })).toBe(false);
  });
});

describe('codecs', () => {
  const chrome = (t: string) => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8'].includes(t);
  it('lists only runtime-supported formats in priority order', () => {
    const f = getSupportedFormats(true, chrome);
    expect(f.map((x) => x.mimeType)).toEqual(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    expect(f[0].extension).toBe('webm');
  });
  it('video-only list excludes audio codecs', () => {
    const f = getSupportedFormats(false, chrome);
    expect(f.every((x) => x.audioCodec === null)).toBe(true);
  });
  it('prefers mp4 when available (Safari-like)', () => {
    const safari = (t: string) => t.startsWith('video/mp4');
    expect(pickFormat(getSupportedFormats(true, safari), 'auto')?.container).toBe('mp4');
  });
  it('returns nothing when MediaRecorder is missing', () => {
    expect(getSupportedFormats(true, undefined)).toEqual([]);
    expect(pickFormat([], 'auto')).toBeNull();
  });
  it('falls back to first format when preferred is unsupported', () => {
    const f = getSupportedFormats(true, chrome);
    expect(pickFormat(f, 'video/mp4')?.mimeType).toBe(f[0].mimeType);
  });
  it('extension from actual blob mime', () => {
    expect(extensionForMime('video/x-matroska;codecs=avc1')).toBe('mkv');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('video/webm;codecs=vp8')).toBe('webm');
  });
});

describe('constraints', () => {
  it('uses ideal values and exact deviceId', () => {
    const c = buildVideoConstraints({ deviceId: 'abc', resolutionId: '1080p', frameRate: 60, aspect: '16:9' });
    expect(c.deviceId).toEqual({ exact: 'abc' });
    expect(c.width).toEqual({ ideal: 1920 });
    expect(c.height).toEqual({ ideal: 1080 });
    expect(c.frameRate).toEqual({ ideal: 60 });
  });
  it('portrait 9:16 swaps orientation', () => {
    const c = buildVideoConstraints({ resolutionId: '1080p', frameRate: 30, aspect: '9:16', facingMode: 'user' });
    expect(c.width).toEqual({ ideal: 1080 });
    expect(c.height).toEqual({ ideal: 1920 });
    expect(c.facingMode).toEqual({ ideal: 'user' });
  });
  it('square 1:1', () => {
    const c = buildVideoConstraints({ resolutionId: '720p', frameRate: 30, aspect: '1:1' });
    expect(c.width).toEqual({ ideal: 720 });
    expect(c.height).toEqual({ ideal: 720 });
  });
  it('audio constraints only include browser-supported keys', () => {
    const c = buildAudioConstraints(
      { deviceId: 'm', echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 2 },
      { echoCancellation: true },
    );
    expect(c).toEqual({ deviceId: { exact: 'm' }, echoCancellation: false });
  });
});

describe('error messages (Korean, actionable)', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['OverconstrainedError', 'overconstrained'],
    ['SecurityError', 'insecure'],
    ['TypeError', 'unsupported'],
    ['WeirdError', 'unknown'],
  ])('%s → %s', (name, code) => {
    const e = describeMediaError({ name }, 'camera');
    expect(e.code).toBe(code);
    expect(e.title).toMatch(/카메라|보안|환경/);
    expect(e.detail.length).toBeGreaterThan(10);
  });
});

describe('format helpers', () => {
  it('bytes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('01:02:05');
    expect(formatDuration(1_250, true)).toBe('00:01.2');
  });
  it('file name template', () => {
    const d = new Date(2026, 9, 9, 7, 5, 3);
    expect(buildFileName('Hiddenent_{type}_{date}_{time}_{seq}', { kind: 'photo', date: d, seq: 7, extension: 'jpg' })).toBe(
      'Hiddenent_photo_20261009_070503_007.jpg',
    );
    expect(buildFileName('a/b:c', { kind: 'video', date: d, seq: 1, extension: 'webm' })).toBe('a_b_c.webm');
    expect(buildFileName('', { kind: 'video', date: d, seq: 1, extension: 'webm' })).toBe('Hiddenent_video_20261009_070503.webm');
  });
  it('rename keeps extension and sanitizes', () => {
    expect(renameKeepingExtension('x.webm', 'my clip')).toBe('my clip.webm');
    expect(renameKeepingExtension('x.jpg', 'pic.jpg')).toBe('pic.jpg');
    expect(sanitizeFileName('  ..hidden?  ')).toBe('hidden_');
  });
});

describe('photo geometry', () => {
  it('center crop to aspect and zoom', () => {
    expect(centerCrop(1920, 1080, 1, 1)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
    const z = centerCrop(1920, 1080, null, 2);
    expect(z).toEqual({ x: 480, y: 270, w: 960, h: 540 });
    const portrait = centerCrop(1920, 1080, 9 / 16, 1);
    expect(portrait.h).toBe(1080);
    expect(portrait.w).toBeCloseTo(607.5);
  });
  it('fits long edge', () => {
    expect(fitLongEdge(4000, 3000, 1920)).toEqual({ w: 1920, h: 1440 });
    expect(fitLongEdge(800, 600, 0)).toEqual({ w: 800, h: 600 });
  });
});

describe('color matrix', () => {
  it('neutral is identity', () => {
    const m = buildColorMatrix({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, effect: 'none' });
    const px = new Uint8ClampedArray([10, 120, 250, 255]);
    applyMatrix(px, m);
    expect(Array.from(px)).toEqual([10, 120, 250, 255]);
  });
  it('mono makes R=G=B', () => {
    const m = buildColorMatrix({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, effect: 'mono' });
    const px = new Uint8ClampedArray([200, 50, 10, 255]);
    applyMatrix(px, m);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
  });
  it('brightness +100 doubles, contrast pivots at mid-grey', () => {
    const px = new Uint8ClampedArray([60, 60, 60, 255]);
    applyMatrix(px, buildColorMatrix({ brightness: 100, contrast: 0, saturation: 0, temperature: 0, effect: 'none' }));
    expect(px[0]).toBe(120);
    const grey = new Uint8ClampedArray([128, 128, 128, 255]);
    applyMatrix(grey, buildColorMatrix({ brightness: 0, contrast: 80, saturation: 0, temperature: 0, effect: 'none' }));
    expect(Math.abs(grey[0] - 128)).toBeLessThanOrEqual(1);
  });
  it('compose order: a then b', () => {
    const scale2 = [2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0];
    const offset = [1, 0, 0, 0, 0.1, 0, 1, 0, 0, 0.1, 0, 0, 1, 0, 0.1, 0, 0, 0, 1, 0];
    const m = compose(scale2, offset); // (x*2)+0.1
    expect(m[0]).toBe(2);
    expect(m[4]).toBeCloseTo(0.1);
    expect(matrixToSvgValues(m).split(' ')).toHaveLength(20);
  });
  it('temperature warms (R up, B down)', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255]);
    applyMatrix(px, buildColorMatrix({ brightness: 0, contrast: 0, saturation: 0, temperature: 100, effect: 'none' }));
    expect(px[0]).toBeGreaterThan(100);
    expect(px[2]).toBeLessThan(100);
  });
});

describe('settings', () => {
  it('merges stored settings with defaults and ignores wrong types', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { video: { frameRate: 60, aspect: 7 }, facing: 'environment', unknown: 1 });
    expect(merged.video.frameRate).toBe(60);
    expect(merged.video.aspect).toBe('16:9');
    expect(merged.facing).toBe('environment');
    expect((merged as unknown as Record<string, unknown>).unknown).toBeUndefined();
    expect(merged.audio).toEqual(DEFAULT_SETTINGS.audio);
  });
  it('bitrate presets scale with resolution; auto leaves it to the browser', () => {
    expect(videoBitrateFor('auto', 0, 1080)).toBeUndefined();
    expect(videoBitrateFor('high', 0, 1080)).toBe(8_000_000);
    expect(videoBitrateFor('high', 0, 2160)).toBe(32_000_000);
    expect(videoBitrateFor('custom', 1234, 720)).toBe(1234);
  });
});
