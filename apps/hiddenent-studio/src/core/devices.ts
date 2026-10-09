// 장치 탐색, 제약 조건 생성, getUserMedia 오류를 쉬운 한국어 안내로 변환.

export type DeviceKind = 'camera' | 'microphone';

export interface DeviceInfo {
  deviceId: string;
  groupId: string;
  label: string;
  /** 권한 부여 전에는 라벨이 비어 있다. */
  hasLabel: boolean;
}

export interface DeviceLists {
  cameras: DeviceInfo[];
  microphones: DeviceInfo[];
}

export async function listDevices(): Promise<DeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], microphones: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  const toInfo = (d: MediaDeviceInfo, i: number, fallback: string): DeviceInfo => ({
    deviceId: d.deviceId,
    groupId: d.groupId,
    label: d.label || `${fallback} ${i + 1}`,
    hasLabel: Boolean(d.label),
  });
  const cams = all.filter((d) => d.kind === 'videoinput');
  const mics = all.filter((d) => d.kind === 'audioinput');
  return {
    cameras: cams.map((d, i) => toInfo(d, i, '카메라')),
    // 'communications' 등 가상 별칭 장치는 운영체제가 노출한 그대로 표시한다(임의 추정하지 않음).
    microphones: mics.map((d, i) => toInfo(d, i, '마이크')),
  };
}

export interface FriendlyError {
  code: string;
  title: string;
  detail: string;
  /** 재시도 버튼을 보여줄지 */
  retryable: boolean;
}

export function describeMediaError(err: unknown, kind: DeviceKind | 'both'): FriendlyError {
  const what = kind === 'camera' ? '카메라' : kind === 'microphone' ? '마이크' : '카메라·마이크';
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        code: 'permission-denied',
        title: `${what} 권한이 거부되었습니다`,
        detail:
          `브라우저 주소창 왼쪽의 자물쇠(사이트 정보) 아이콘을 눌러 ${what} 권한을 '허용'으로 바꾼 뒤 ` +
          `'다시 시도'를 누르세요. 운영체제 설정(Windows: 개인정보 > 카메라/마이크, macOS: 시스템 설정 > 개인정보 보호)에서 ` +
          `브라우저의 접근이 막혀 있는지도 확인하세요.`,
        retryable: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        code: 'not-found',
        title: `${what}를 찾을 수 없습니다`,
        detail: `${what}가 연결되어 있는지 확인하세요. USB 장치라면 다시 꽂은 뒤 '장치 다시 찾기'를 누르세요.`,
        retryable: true,
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        code: 'in-use',
        title: `${what}를 열 수 없습니다(사용 중이거나 하드웨어 오류)`,
        detail:
          `Zoom, Teams, OBS, 다른 브라우저 탭 등 ${what}를 사용하는 프로그램을 종료한 뒤 다시 시도하세요. ` +
          `계속 실패하면 장치를 다시 연결하거나 컴퓨터를 재시작하세요.`,
        retryable: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        code: 'overconstrained',
        title: `선택한 설정을 ${what}가 지원하지 않습니다`,
        detail: `해상도·프레임 레이트 등 설정을 낮추거나 다른 장치를 선택하세요.`,
        retryable: true,
      };
    case 'SecurityError':
      return {
        code: 'insecure',
        title: '보안 정책으로 장치 접근이 차단되었습니다',
        detail: 'HTTPS 주소(또는 localhost)에서 접속했는지, iframe 의 권한 정책(allow="camera; microphone")이 설정되었는지 확인하세요.',
        retryable: false,
      };
    case 'TypeError':
      return {
        code: 'unsupported',
        title: '이 환경에서는 카메라·마이크 API를 사용할 수 없습니다',
        detail: 'HTTPS 또는 localhost 에서 접속하고, 최신 Chrome·Edge·Firefox·Safari 를 사용하세요.',
        retryable: false,
      };
    default:
      return {
        code: 'unknown',
        title: `${what}를 시작하지 못했습니다`,
        detail: `알 수 없는 오류(${name || '정보 없음'})입니다. 페이지를 새로고침하거나 다른 브라우저로 시도하세요.`,
        retryable: true,
      };
  }
}

export function mediaApiAvailable(): FriendlyError | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      code: 'insecure',
      title: '보안 연결(HTTPS)이 필요합니다',
      detail: '카메라와 마이크는 HTTPS 또는 localhost 주소에서만 사용할 수 있습니다. 주소를 https:// 로 바꿔 접속하세요.',
      retryable: false,
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      code: 'unsupported',
      title: '이 브라우저는 카메라 API를 지원하지 않습니다',
      detail: '최신 Chrome, Edge, Firefox, Safari 를 사용하세요.',
      retryable: false,
    };
  }
  return null;
}

export interface ResolutionOption {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTIONS: ResolutionOption[] = [
  { id: '2160p', label: '4K UHD (3840×2160)', width: 3840, height: 2160 },
  { id: '1440p', label: 'QHD (2560×1440)', width: 2560, height: 1440 },
  { id: '1080p', label: 'Full HD (1920×1080)', width: 1920, height: 1080 },
  { id: '720p', label: 'HD (1280×720)', width: 1280, height: 720 },
  { id: '480p', label: 'SD (854×480)', width: 854, height: 480 },
];

export const FRAME_RATES = [24, 25, 30, 50, 60];

export type AspectId = '16:9' | '9:16' | '4:3' | '1:1';
export const ASPECTS: { id: AspectId; ratio: number; label: string }[] = [
  { id: '16:9', ratio: 16 / 9, label: '16:9 가로' },
  { id: '9:16', ratio: 9 / 16, label: '9:16 세로' },
  { id: '4:3', ratio: 4 / 3, label: '4:3' },
  { id: '1:1', ratio: 1, label: '1:1 정사각' },
];

export function aspectRatioOf(id: AspectId): number {
  return ASPECTS.find((a) => a.id === id)?.ratio ?? 16 / 9;
}

export interface VideoRequest {
  deviceId?: string;
  facingMode?: 'user' | 'environment';
  resolutionId: string;
  frameRate: number;
  aspect: AspectId;
}

/**
 * 비디오 제약 조건. 'ideal' 만 사용해 장치가 지원하지 않으면 가장 가까운 값으로 열리도록 한다.
 * 실제 적용된 값은 track.getSettings() 로 따로 표시한다.
 * 세로(9:16) 비율은 센서 방향과 무관하게 긴 변을 높이로 요청한다.
 */
export function buildVideoConstraints(req: VideoRequest): MediaTrackConstraints {
  const res = RESOLUTIONS.find((r) => r.id === req.resolutionId) ?? RESOLUTIONS[3];
  const ratio = aspectRatioOf(req.aspect);
  const long = res.width;
  const short = res.height;
  let width: number;
  let height: number;
  if (ratio >= 1) {
    height = short;
    width = Math.round(short * ratio);
  } else {
    width = short;
    height = Math.round(short / ratio);
    if (height > long) height = long;
  }
  const c: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: req.frameRate },
    aspectRatio: { ideal: ratio },
  };
  if (req.deviceId) c.deviceId = { exact: req.deviceId };
  else if (req.facingMode) c.facingMode = { ideal: req.facingMode };
  return c;
}

export interface AudioRequest {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** 1 = 모노, 2 = 스테레오 요청 */
  channelCount: number;
}

export function buildAudioConstraints(req: AudioRequest, supported: MediaTrackSupportedConstraints): MediaTrackConstraints {
  const c: MediaTrackConstraints = {};
  if (req.deviceId) c.deviceId = { exact: req.deviceId };
  if (supported.echoCancellation) c.echoCancellation = req.echoCancellation;
  if (supported.noiseSuppression) c.noiseSuppression = req.noiseSuppression;
  if (supported.autoGainControl) c.autoGainControl = req.autoGainControl;
  if (supported.channelCount) c.channelCount = { ideal: req.channelCount };
  return c;
}

/** 트랙 기능 조회(지원하지 않는 브라우저는 빈 객체). */
export function trackCapabilities(track: MediaStreamTrack | null | undefined): MediaTrackCapabilities & Record<string, unknown> {
  if (!track || typeof track.getCapabilities !== 'function') return {};
  try {
    return track.getCapabilities() as MediaTrackCapabilities & Record<string, unknown>;
  } catch {
    return {};
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* noop */
    }
  });
}

/** 권한 상태 조회(Permissions API 미지원 시 'unknown'). */
export async function queryPermission(name: 'camera' | 'microphone'): Promise<PermissionState | 'unknown'> {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}
