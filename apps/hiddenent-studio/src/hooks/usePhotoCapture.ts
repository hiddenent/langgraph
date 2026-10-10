// 사진 촬영: 셀프 타이머 → 단일/버스트/인터벌 촬영 → 라이브러리 추가.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageFormat, IMAGE_FORMATS, detectImageFormats } from '../core/codecs';
import { EFFECT_LABELS, isNeutral } from '../core/colorMatrix';
import { runCountdown, sleep } from '../core/countdown';
import { buildFileName } from '../core/format';
import { capturePhoto, createImageCapture, imageCaptureSupported, loadImage, makeThumbnail } from '../core/photo';
import type { Settings } from '../core/settings';
import { countdownBeep, shutterSound } from '../core/sound';
import { MediaItem, newId } from '../core/storage';

export type PhotoPhase = 'idle' | 'countdown' | 'capturing' | 'sequence';

export interface PhotoCaptureHandle {
  phase: PhotoPhase;
  countdownLeft: number;
  sequenceCount: number;
  flashKey: number;
  lastShot: MediaItem | null;
  imageFormats: ImageFormat[];
  clearLastShot(): void;
  capture(): Promise<void>;
  cancel(): void;
}

interface Options {
  settings: Settings;
  videoEl: React.RefObject<HTMLVideoElement>;
  cameraTrack: MediaStreamTrack | null;
  digitalZoom: number;
  /** 실제 적용할 화면 비율(휴대폰 세로 방향 자동 전환 반영) */
  aspectRatio: number;
  onSaved: (item: MediaItem) => void;
  notify: (kind: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => resolve('');
    r.readAsDataURL(blob);
  });
}

export function usePhotoCapture(o: Options): PhotoCaptureHandle {
  const [phase, setPhase] = useState<PhotoPhase>('idle');
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [sequenceCount, setSequenceCount] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [lastShot, setLastShot] = useState<MediaItem | null>(null);
  const [imageFormats, setImageFormats] = useState<ImageFormat[]>(IMAGE_FORMATS.slice(0, 2));
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(1);
  const optsRef = useRef(o);
  optsRef.current = o;

  useEffect(() => {
    void detectImageFormats().then((f) => f.length && setImageFormats(f));
  }, []);

  const shootOnce = useCallback(async (): Promise<boolean> => {
    const { settings: s, videoEl, cameraTrack, digitalZoom, aspectRatio } = optsRef.current;
    const v = videoEl.current;
    if (!v || !cameraTrack || cameraTrack.readyState !== 'live' || !v.videoWidth) {
      optsRef.current.notify('error', '카메라가 준비되지 않아 사진을 찍을 수 없습니다.');
      return false;
    }
    const p = s.photo;
    const format = imageFormats.find((f) => f.mime === p.format) ?? imageFormats[0];
    const date = new Date();
    const ic = p.useImageCapture && imageCaptureSupported() ? createImageCapture(cameraTrack) : null;
    try {
      if (p.shutterSound) shutterSound();
      setFlashKey((k) => k + 1);
      const shot = await capturePhoto(
        v,
        {
          aspect: aspectRatio,
          digitalZoom,
          mirror: p.mirrorFile,
          rotation: p.rotation,
          color: p.color,
          timestamp: p.timestamp,
          watermark: { text: p.watermarkText, position: p.watermarkPosition, opacity: p.watermarkOpacity },
          maxLongEdge: p.maxLongEdge,
          mime: format.mime,
          quality: p.quality,
          captureDate: date,
        },
        ic,
      );
      const img = await loadImage(shot.blob);
      const thumb = makeThumbnail(img, 360);
      const before = await blobToDataUrl(shot.beforeBlob);
      const item: MediaItem = {
        id: newId(),
        kind: 'photo',
        name: buildFileName(p.fileTemplate, { kind: 'photo', date, seq: seqRef.current++, extension: format.extension }),
        mime: shot.blob.type || format.mime,
        size: shot.blob.size,
        createdAt: date.getTime(),
        width: shot.width,
        height: shot.height,
        thumbnail: thumb,
        beforeThumb: before,
        afterThumb: thumb,
        blob: shot.blob,
        persisted: false,
        meta: {
          형식: format.label + (format.lossy ? ` (품질 ${Math.round(p.quality * 100)}%)` : ''),
          '캡처 방식': shot.source === 'imagecapture' ? 'ImageCapture.takePhoto (카메라 사진 해상도)' : '미리보기 프레임 캡처',
          화면비율: aspectRatio < 1 && p.aspect !== '9:16' ? `${p.aspect} (세로 방향 자동 전환)` : p.aspect,
          '디지털 확대': digitalZoom > 1 ? `${digitalZoom.toFixed(1)}×` : '없음',
          '색 보정(소프트웨어)': isNeutral(p.color)
            ? '없음'
            : `밝기 ${p.color.brightness}, 대비 ${p.color.contrast}, 채도 ${p.color.saturation}, 색온도 ${p.color.temperature}, 효과 ${EFFECT_LABELS[p.color.effect]}`,
          '파일 좌우 반전': p.mirrorFile ? '예' : '아니요',
          회전: `${p.rotation}°`,
        },
      };
      optsRef.current.onSaved(item);
      setLastShot(item);
      return true;
    } catch (e) {
      optsRef.current.notify('error', `사진 촬영 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
      return false;
    }
  }, [imageFormats]);

  const capture = useCallback(async () => {
    if (phase !== 'idle') return;
    const s = optsRef.current.settings;
    const ac = new AbortController();
    abortRef.current = ac;
    if (s.photo.timer > 0) {
      setPhase('countdown');
      const ok = await runCountdown(
        s.photo.timer,
        (left) => {
          setCountdownLeft(left);
          if (left > 0 && s.ui.countdownSound) countdownBeep(left === 1);
        },
        ac.signal,
      );
      if (!ok) {
        setPhase('idle');
        abortRef.current = null;
        return;
      }
    }
    const drive = s.photo.drive;
    if (drive === 'single') {
      setPhase('capturing');
      await shootOnce();
    } else {
      setPhase('sequence');
      const total = drive === 'burst' ? s.photo.burstCount : s.photo.intervalMax;
      const gap = drive === 'burst' ? s.photo.burstIntervalMs : s.photo.intervalSec * 1000;
      let taken = 0;
      setSequenceCount(0);
      for (let i = 0; i < total; i++) {
        if (ac.signal.aborted) break;
        const ok = await shootOnce();
        if (!ok) break;
        taken++;
        setSequenceCount(taken);
        if (i < total - 1 && !(await sleep(gap, ac.signal))) break;
      }
      optsRef.current.notify('success', `${drive === 'burst' ? '버스트' : '인터벌'} 촬영 완료: ${taken}장`);
    }
    abortRef.current = null;
    setPhase('idle');
  }, [phase, shootOnce]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    phase,
    countdownLeft,
    sequenceCount,
    flashKey,
    lastShot,
    imageFormats,
    clearLastShot: () => setLastShot(null),
    capture,
    cancel,
  };
}
