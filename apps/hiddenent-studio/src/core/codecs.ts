// MediaRecorder 컨테이너·코덱 지원 여부를 런타임에 확인한다.

export interface RecordingFormat {
  mimeType: string;
  container: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  audioCodec: string | null;
  label: string;
  extension: string;
}

interface Candidate {
  mime: string;
  container: RecordingFormat['container'];
  video: string;
  audio: string | null;
}

// 우선순위 순서: 범용 재생 호환성이 높은 MP4(H.264) → WebM(VP9/VP8) → MP4(VP9/AV1) → 브라우저 기본.
// 주의: Chromium 의 'video/mp4'(코덱 미지정)는 VP9/Opus MP4 를 만들 수 있어 호환성이 낮으므로 마지막에 둔다.
const CANDIDATES: Candidate[] = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', container: 'mp4', video: 'H.264 High', audio: 'AAC' },
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', container: 'mp4', video: 'H.264 Baseline', audio: 'AAC' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', container: 'mp4', video: 'H.264', audio: 'AAC' },
  { mime: 'video/mp4;codecs=avc1,opus', container: 'mp4', video: 'H.264', audio: 'Opus' },
  // iOS Safari 는 따옴표·공백이 있는 표기만 인식하는 버전이 있다.
  { mime: 'video/mp4;codecs="avc1.42E01E, mp4a.40.2"', container: 'mp4', video: 'H.264 Baseline', audio: 'AAC' },
  { mime: 'video/webm;codecs=vp9,opus', container: 'webm', video: 'VP9', audio: 'Opus' },
  { mime: 'video/webm;codecs=vp8,opus', container: 'webm', video: 'VP8', audio: 'Opus' },
  { mime: 'video/webm;codecs=av01,opus', container: 'webm', video: 'AV1', audio: 'Opus' },
  { mime: 'video/webm;codecs=h264,opus', container: 'webm', video: 'H.264', audio: 'Opus' },
  { mime: 'video/mp4;codecs=hvc1.1.6.L120.B0,mp4a.40.2', container: 'mp4', video: 'H.265/HEVC', audio: 'AAC' },
  { mime: 'video/mp4;codecs=vp9,opus', container: 'mp4', video: 'VP9', audio: 'Opus' },
  { mime: 'video/mp4;codecs=av01,opus', container: 'mp4', video: 'AV1', audio: 'Opus' },
  { mime: 'video/x-matroska;codecs=avc1,opus', container: 'mkv', video: 'H.264', audio: 'Opus' },
  { mime: 'video/webm', container: 'webm', video: '브라우저 기본', audio: '브라우저 기본' },
  { mime: 'video/mp4', container: 'mp4', video: '브라우저 기본', audio: '브라우저 기본' },
];

const VIDEO_ONLY: Candidate[] = [
  { mime: 'video/mp4;codecs=avc1.640028', container: 'mp4', video: 'H.264 High', audio: null },
  { mime: 'video/mp4;codecs=avc1.42E01E', container: 'mp4', video: 'H.264 Baseline', audio: null },
  { mime: 'video/mp4;codecs=avc1', container: 'mp4', video: 'H.264', audio: null },
  { mime: 'video/webm;codecs=vp9', container: 'webm', video: 'VP9', audio: null },
  { mime: 'video/webm;codecs=vp8', container: 'webm', video: 'VP8', audio: null },
  { mime: 'video/webm;codecs=av01', container: 'webm', video: 'AV1', audio: null },
  { mime: 'video/mp4;codecs=vp9', container: 'mp4', video: 'VP9', audio: null },
  { mime: 'video/webm', container: 'webm', video: '브라우저 기본', audio: null },
  { mime: 'video/mp4', container: 'mp4', video: '브라우저 기본', audio: null },
];

const EXT: Record<RecordingFormat['container'], string> = { mp4: 'mp4', webm: 'webm', mkv: 'mkv' };

export function getSupportedFormats(
  withAudio: boolean,
  isTypeSupported: ((t: string) => boolean) | undefined = typeof MediaRecorder !== 'undefined'
    ? (t) => MediaRecorder.isTypeSupported(t)
    : undefined,
): RecordingFormat[] {
  if (!isTypeSupported) return [];
  const list = withAudio ? CANDIDATES : VIDEO_ONLY;
  const out: RecordingFormat[] = [];
  for (const c of list) {
    let ok = false;
    try {
      ok = isTypeSupported(c.mime);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    out.push({
      mimeType: c.mime,
      container: c.container,
      videoCodec: c.video,
      audioCodec: c.audio,
      extension: EXT[c.container],
      label: `${c.container.toUpperCase()} · ${c.video}${c.audio ? ` + ${c.audio}` : ' (오디오 없음)'}`,
    });
  }
  if (out.length === 0) {
    // isTypeSupported 가 아무것도 인정하지 않아도 MediaRecorder 자체는 동작하는 모바일 브라우저가 있다.
    // 형식을 지정하지 않고 브라우저 기본값으로 녹화하며, 실제 형식은 녹화 후 파일에서 확인한다.
    out.push({
      mimeType: '',
      container: 'mp4',
      videoCodec: '브라우저 기본',
      audioCodec: withAudio ? '브라우저 기본' : null,
      extension: 'mp4',
      label: '브라우저 기본 형식(녹화 후 확인)',
    });
  }
  return out;
}

/** 'auto' 이면 지원 목록의 첫 항목(우선순위 최상위)을 고른다. */
export function pickFormat(supported: RecordingFormat[], preferred: string): RecordingFormat | null {
  if (supported.length === 0) return null;
  if (preferred && preferred !== 'auto') {
    const found = supported.find((f) => f.mimeType === preferred);
    if (found) return found;
  }
  return supported[0];
}

/** 실제 생성된 Blob 의 MIME 타입에서 확장자를 정한다(브라우저가 요청과 다른 타입을 줄 수 있다). */
export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('matroska')) return 'mkv';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('quicktime')) return 'mov';
  return 'bin';
}

export interface ImageFormat {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  label: string;
  extension: string;
  lossy: boolean;
}

export const IMAGE_FORMATS: ImageFormat[] = [
  { mime: 'image/jpeg', label: 'JPEG', extension: 'jpg', lossy: true },
  { mime: 'image/png', label: 'PNG (무손실)', extension: 'png', lossy: false },
  { mime: 'image/webp', label: 'WebP', extension: 'webp', lossy: true },
];

/** canvas.toBlob 으로 실제 생성 가능한 이미지 형식만 확인한다(요청과 다른 형식으로 대체되는지 검사). */
export async function detectImageFormats(): Promise<ImageFormat[]> {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const results = await Promise.all(
    IMAGE_FORMATS.map(
      (f) =>
        new Promise<ImageFormat | null>((resolve) => {
          try {
            canvas.toBlob((b) => resolve(b && b.type === f.mime ? f : null), f.mime, 0.9);
          } catch {
            resolve(null);
          }
        }),
    ),
  );
  return results.filter((f): f is ImageFormat => f !== null);
}
