import { useEffect, useRef } from 'react';

/** 노출 보조용 밝기(루마) 히스토그램. 축소된 프레임을 4Hz 로 샘플링한다. */
export function Histogram({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const sample = document.createElement('canvas');
    sample.width = 160;
    sample.height = 90;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const out = canvasRef.current;
      if (!v || !out || !sctx || !v.videoWidth) return;
      try {
        sctx.drawImage(v, 0, 0, sample.width, sample.height);
        const { data } = sctx.getImageData(0, 0, sample.width, sample.height);
        const bins = new Array<number>(64).fill(0);
        let clipped = 0;
        for (let i = 0; i < data.length; i += 4) {
          const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          bins[Math.min(63, Math.floor(y / 4))]++;
          if (y >= 250) clipped++;
        }
        const max = Math.max(...bins, 1);
        const ctx = out.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, out.width, out.height);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, out.width, out.height);
        const bw = out.width / bins.length;
        bins.forEach((b, i) => {
          const h = (b / max) * (out.height - 4);
          ctx.fillStyle = i >= 62 ? '#ff5d5d' : 'rgba(240,240,240,0.85)';
          ctx.fillRect(i * bw, out.height - h, Math.max(1, bw - 0.5), h);
        });
        if (clipped / (data.length / 4) > 0.02) {
          ctx.fillStyle = '#ff5d5d';
          ctx.font = '10px system-ui';
          ctx.fillText('과다 노출', 4, 12);
        }
      } catch {
        /* 프레임 미준비 */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [videoRef]);
  return (
    <canvas
      ref={canvasRef}
      className="histogram"
      width={192}
      height={72}
      role="img"
      aria-label="밝기 히스토그램(카메라 원본 기준)"
      title="밝기 히스토그램(카메라 원본 기준, 오른쪽 빨간색 = 하이라이트 클리핑)"
    />
  );
}
