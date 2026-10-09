// 카메라가 요청한 화면 비율을 직접 제공하지 못하거나 디지털 확대·파일 좌우 반전이 필요할 때
// 캔버스에 프레임을 그려 captureStream() 으로 녹화용 비디오 트랙을 만든다.
// 주의: 브라우저 탭이 백그라운드로 가면 그리기 루프가 느려지거나 멈출 수 있다.

import { centerCrop, fitLongEdge } from './photo';

export interface PipelineOptions {
  aspect: number;
  zoom: number;
  mirror: boolean;
  fps: number;
  maxLongEdge: number;
}

export function canvasCaptureSupported(): boolean {
  return typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export class CanvasPipeline {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private handle = 0;
  private stream: MediaStream | null = null;
  private useVfc: boolean;

  constructor(
    private video: HTMLVideoElement,
    private opts: PipelineOptions,
  ) {
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
    this.ctx = ctx;
    this.useVfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    this.resize();
  }

  private resize(): void {
    const crop = centerCrop(this.video.videoWidth, this.video.videoHeight, this.opts.aspect, this.opts.zoom);
    // 인코더 호환을 위해 짝수 크기로 맞춘다.
    const size = fitLongEdge(crop.w, crop.h, this.opts.maxLongEdge);
    this.canvas.width = Math.max(2, size.w - (size.w % 2));
    this.canvas.height = Math.max(2, size.h - (size.h % 2));
  }

  get size(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  private draw = (): void => {
    if (!this.running) return;
    const v = this.video;
    if (v.videoWidth && v.videoHeight) {
      const crop = centerCrop(v.videoWidth, v.videoHeight, this.opts.aspect, this.opts.zoom);
      const { width, height } = this.canvas;
      this.ctx.save();
      if (this.opts.mirror) {
        this.ctx.translate(width, 0);
        this.ctx.scale(-1, 1);
      }
      this.ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
      this.ctx.restore();
    }
    this.schedule();
  };

  private schedule(): void {
    if (!this.running) return;
    if (this.useVfc) {
      this.handle = (this.video as HTMLVideoElement & {
        requestVideoFrameCallback(cb: () => void): number;
      }).requestVideoFrameCallback(this.draw);
    } else {
      this.handle = requestAnimationFrame(this.draw);
    }
  }

  start(): MediaStream {
    this.running = true;
    this.draw();
    this.stream = this.canvas.captureStream(this.opts.fps);
    return this.stream;
  }

  stop(): void {
    this.running = false;
    if (this.useVfc) {
      (this.video as HTMLVideoElement & { cancelVideoFrameCallback?(h: number): void }).cancelVideoFrameCallback?.(
        this.handle,
      );
    } else {
      cancelAnimationFrame(this.handle);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
