// 브라우저 기능 지원 현황(장치 및 환경 설정 화면, 대체 기능 선택에 사용).

import { canvasCaptureSupported } from './canvasPipeline';
import { imageCaptureSupported } from './photo';
import { canPauseRecording } from './recorder';
import { indexedDbSupported } from './storage';

export interface FeatureRow {
  id: string;
  label: string;
  supported: boolean;
  note: string;
}

export function detectFeatures(): FeatureRow[] {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const supportedConstraints = md?.getSupportedConstraints?.() ?? {};
  const rows: FeatureRow[] = [
    {
      id: 'secure',
      label: '보안 컨텍스트(HTTPS/localhost)',
      supported: window.isSecureContext,
      note: '카메라·마이크 접근의 필수 조건',
    },
    { id: 'gum', label: 'getUserMedia (카메라·마이크)', supported: Boolean(md?.getUserMedia), note: 'MediaDevices API' },
    { id: 'enum', label: 'enumerateDevices (장치 목록)', supported: Boolean(md?.enumerateDevices), note: '' },
    { id: 'recorder', label: 'MediaRecorder (동영상 녹화)', supported: typeof MediaRecorder !== 'undefined', note: '' },
    { id: 'pause', label: '녹화 일시정지/재개', supported: canPauseRecording(), note: 'MediaRecorder.pause/resume' },
    {
      id: 'audioctx',
      label: 'Web Audio (오디오 레벨 분석)',
      supported: typeof AudioContext !== 'undefined',
      note: 'AudioContext + AnalyserNode',
    },
    { id: 'imagecapture', label: 'ImageCapture (고해상도 사진)', supported: imageCaptureSupported(), note: '미지원 시 미리보기 프레임 캡처' },
    { id: 'capturestream', label: 'canvas.captureStream (비율 자르기 녹화)', supported: canvasCaptureSupported(), note: '' },
    {
      id: 'vfc',
      label: 'requestVideoFrameCallback',
      supported: typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
      note: '미지원 시 requestAnimationFrame 사용',
    },
    { id: 'idb', label: 'IndexedDB (로컬 영구 저장)', supported: indexedDbSupported(), note: '' },
    {
      id: 'persist',
      label: 'StorageManager.persist (저장소 보존 요청)',
      supported: Boolean(navigator.storage?.persist),
      note: '',
    },
    { id: 'perm', label: 'Permissions API (권한 상태 조회)', supported: Boolean(navigator.permissions?.query), note: '' },
    {
      id: 'ec',
      label: '에코 제거 제약',
      supported: Boolean(supportedConstraints.echoCancellation),
      note: 'echoCancellation',
    },
    {
      id: 'ns',
      label: '노이즈 억제 제약',
      supported: Boolean(supportedConstraints.noiseSuppression),
      note: 'noiseSuppression',
    },
    {
      id: 'agc',
      label: '자동 게인 제어 제약',
      supported: Boolean(supportedConstraints.autoGainControl),
      note: 'autoGainControl',
    },
    {
      id: 'facing',
      label: '전면/후면 카메라 지정',
      supported: Boolean(supportedConstraints.facingMode),
      note: 'facingMode',
    },
    {
      id: 'getcaps',
      label: '트랙 기능 조회(getCapabilities)',
      supported: typeof MediaStreamTrack !== 'undefined' && 'getCapabilities' in MediaStreamTrack.prototype,
      note: 'Firefox 는 일부 버전에서 미지원',
    },
  ];
  return rows;
}
