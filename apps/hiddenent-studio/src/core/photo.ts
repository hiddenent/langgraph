// 사진 캡처 및 후처리: 비율 자르기, 디지털 확대, 좌우 반전, 회전, 색 보정, 날짜·워터마크.

import { ColorAdjust, applyMatrix, buildColorMatrix, isNeutral } from './colorMatrix';
import { formatDateTime } from './format';

// ImageCapture 는 일부 브라우저(Chromium 계열)에서만 제공된다.
export interface ImageCaptureLike {
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number; fillLightMode?: string }): Promise<Blob>;
  getPhotoCapabilities?(): Promise<{ imageWidth?: { min: number; max: number }; imageHeight?: { min: number; max: number } }>;
  grabFrame?(): Promise<ImageBitmap>;
}

export function imageCaptureSupported(): boolean {
  return typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === 'function';
}

export function createImageCapture(track: MediaStreamTrack): ImageCaptureLike | null {
  const Ctor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (!Ctor) return null;
  try {
    return new Ctor(track);
  } catch {
    return null;
  }
}

export type Rotation = 0 | 90 | 180 | 270;
export type WatermarkPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';

export interface PhotoRenderOptions {
  aspect: number | null;
  digitalZoom: number;
  mirror: boolean;
  rotation: Rotation;
  color: ColorAdjust;
  timestamp: boolean;
  watermark: { text: string; position: WatermarkPosition; opacity: number };
  /** 긴 변 최대 픽셀(0 = 원본 유지) */
  maxLongEdge: number;
  mime: string;
  quality: number;
  captureDate: Date;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 중앙 기준으로 비율·확대에 맞는 원본 영역을 계산한다. */
export function centerCrop(sw: number, sh: number, aspect: number | null, zoom: number): CropRect {
  let w = sw;
  let h = sh;
  if (aspect && aspect > 0) {
    if (sw / sh > aspect) w = sh * aspect;
    else h = sw / aspect;
  }
  const z = Math.max(1, zoom || 1);
  w /= z;
  h /= z;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

export function fitLongEdge(w: number, h: number, maxLong: number): { w: number; h: number } {
  if (!maxLong || Math.max(w, h) <= maxLong) return { w: Math.round(w), h: Math.round(h) };
  const s = maxLong / Math.max(w, h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('이미지 파일을 만들지 못했습니다(메모리 부족 가능성).'))),
        mime,
        quality,
      );
    } catch (e) {
      reject(e);
    }
  });
}

type Drawable = HTMLVideoElement | ImageBitmap | HTMLImageElement | HTMLCanvasElement;

function sourceSize(src: Drawable): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

function drawOverlays(ctx: CanvasRenderingContext2D, w: number, h: number, o: PhotoRenderOptions): void {
  const base = Math.max(12, Math.round(Math.min(w, h) * 0.035));
  ctx.save();
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = Math.round(base / 4);
  const margin = Math.round(base * 0.8);
  if (o.timestamp) {
    ctx.font = `600 ${base}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = '#ffb547';
    ctx.textAlign = 'right';
    ctx.fillText(formatDateTime(o.captureDate), w - margin, h - margin);
  }
  const text = o.watermark.text.trim();
  if (text) {
    ctx.globalAlpha = Math.min(1, Math.max(0.05, o.watermark.opacity));
    ctx.font = `700 ${Math.round(base * 1.1)}px system-ui, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif`;
    ctx.fillStyle = '#ffffff';
    let x = margin;
    let y = h - margin;
    ctx.textAlign = 'left';
    switch (o.watermark.position) {
      case 'bottom-right':
        ctx.textAlign = 'right';
        x = w - margin;
        y = o.timestamp ? h - margin - base * 1.4 : h - margin;
        break;
      case 'top-left':
        ctx.textBaseline = 'top';
        y = margin;
        break;
      case 'top-right':
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';
        x = w - margin;
        y = margin;
        break;
      case 'center':
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        x = w / 2;
        y = h / 2;
        break;
      default:
        break;
    }
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

/**
 * 원본 프레임을 옵션에 맞게 렌더링한다.
 * applyLook=false 이면 색 보정·오버레이 없이 구도(자르기·회전·반전)만 적용한다(전후 비교용).
 */
export function renderToCanvas(src: Drawable, o: PhotoRenderOptions, applyLook = true, maxLongOverride?: number): HTMLCanvasElement {
  const { w: sw, h: sh } = sourceSize(src);
  if (!sw || !sh) throw new Error('카메라 프레임이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.');
  const crop = centerCrop(sw, sh, o.aspect, o.digitalZoom);
  const out = fitLongEdge(crop.w, crop.h, maxLongOverride ?? o.maxLongEdge);
  const rotated = o.rotation === 90 || o.rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = rotated ? out.h : out.w;
  canvas.height = rotated ? out.w : out.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: applyLook && !isNeutral(o.color) });
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((o.rotation * Math.PI) / 180);
  if (o.mirror) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, -out.w / 2, -out.h / 2, out.w, out.h);
  ctx.restore();
  if (applyLook) {
    if (!isNeutral(o.color)) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyMatrix(img.data, buildColorMatrix(o.color));
      ctx.putImageData(img, 0, 0);
    }
    drawOverlays(ctx, canvas.width, canvas.height, o);
  }
  return canvas;
}

export interface CapturedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** 보정 전(구도만 적용) 미리보기 — 전후 비교용 */
  beforeBlob: Blob;
  source: 'imagecapture' | 'frame';
}

export async function capturePhoto(
  video: HTMLVideoElement,
  o: PhotoRenderOptions,
  imageCapture: ImageCaptureLike | null,
): Promise<CapturedPhoto> {
  let src: Drawable = video;
  let source: CapturedPhoto['source'] = 'frame';
  let bitmap: ImageBitmap | null = null;
  if (imageCapture) {
    try {
      const raw = await imageCapture.takePhoto();
      bitmap = await createImageBitmap(raw);
      src = bitmap;
      source = 'imagecapture';
    } catch {
      // ImageCapture 실패 시(일부 장치 미지원) 미리보기 프레임으로 대체한다.
      src = video;
      source = 'frame';
    }
  }
  try {
    const canvas = renderToCanvas(src, o, true);
    const blob = await canvasToBlob(canvas, o.mime, o.quality);
    const beforeCanvas = renderToCanvas(src, o, false, 1280);
    const beforeBlob = await canvasToBlob(beforeCanvas, 'image/jpeg', 0.85);
    return { blob, width: canvas.width, height: canvas.height, beforeBlob, source };
  } finally {
    bitmap?.close();
  }
}

export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다.'));
    };
    img.src = url;
  });
}

/** 촬영 후 편집: 정규화 좌표(0~1)로 자르고 회전한다. */
export async function editPhoto(
  blob: Blob,
  crop: CropRect,
  rotation: Rotation,
  mime: string,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(blob);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const cx = Math.round(crop.x * sw);
  const cy = Math.round(crop.y * sh);
  const cw = Math.max(1, Math.round(crop.w * sw));
  const ch = Math.max(1, Math.round(crop.h * sh));
  const rotated = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = rotated ? ch : cw;
  canvas.height = rotated ? cw : ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, cx, cy, cw, ch, -cw / 2, -ch / 2, cw, ch);
  const out = await canvasToBlob(canvas, mime, quality);
  return { blob: out, width: canvas.width, height: canvas.height };
}

/** 썸네일(JPEG data URL). IndexedDB 에 함께 저장하기 쉽도록 문자열로 만든다. */
export function makeThumbnail(src: Drawable, maxLong = 320): string {
  const { w, h } = sourceSize(src);
  if (!w || !h) return '';
  const size = fitLongEdge(w, h, maxLong);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(src, 0, 0, size.w, size.h);
  try {
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return '';
  }
}
