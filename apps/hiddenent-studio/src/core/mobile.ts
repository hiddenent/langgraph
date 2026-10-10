// 모바일(안드로이드·아이폰) 호환 처리.
//  - 플랫폼·인앱 브라우저 감지와 외부 브라우저로 열기
//  - 세로로 든 휴대폰에서 가로 비율 설정을 세로 비율로 자동 전환
//  - iOS Safari 의 자동재생 정책 대응: 사용자 터치 안에서 AudioContext 를 만들고 재개한다

export interface PlatformInfo {
  ios: boolean;
  android: boolean;
  mobile: boolean;
  /** 카메라를 막는 경우가 많은 앱 내장 브라우저 이름(카카오톡, 네이버 등) */
  inApp: string | null;
  fileProtocol: boolean;
}

const IN_APP: [RegExp, string][] = [
  [/KAKAOTALK/i, '카카오톡'],
  [/NAVER\(inapp|NAVER/i, '네이버 앱'],
  [/DaumApps|DaumDevice/i, '다음 앱'],
  [/Instagram/i, '인스타그램'],
  [/FBAN|FBAV|FB_IAB/i, '페이스북'],
  [/Line\//i, '라인'],
  [/BAND\//i, '밴드'],
  [/everytimeApp/i, '에브리타임'],
  [/; wv\)/i, '앱 내장 웹뷰'],
];

export function detectPlatform(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '', maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0, protocol = typeof location !== 'undefined' ? location.protocol : 'https:'): PlatformInfo {
  // iPadOS 13+ 은 데스크톱 Safari UA 를 쓰므로 터치 지점 수로 구분한다.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  let inApp: string | null = null;
  for (const [re, name] of IN_APP) {
    if (re.test(ua)) {
      inApp = name;
      break;
    }
  }
  return { ios, android, mobile: ios || android || /Mobi/i.test(ua), inApp, fileProtocol: protocol === 'file:' };
}

/** 인앱 브라우저에서 기본 브라우저로 여는 주소. 지원하지 않으면 null(사용자 안내로 대체). */
export function externalOpenUrl(p: PlatformInfo, href: string): string | null {
  if (!/^https?:/i.test(href)) return null;
  if (p.inApp === '카카오톡') return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  if (p.android) {
    const u = new URL(href);
    return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`;
  }
  return null;
}

/**
 * 휴대폰을 세로로 들면 카메라가 세로 프레임(높이 > 너비)을 보낸다.
 * 이때 가로 비율(16:9, 4:3)을 그대로 쓰면 화면 가운데 띠만 남으므로 세로 비율(9:16, 3:4)로 뒤집는다.
 */
export function orientAspect(ratio: number, frame: { w: number; h: number }, auto: boolean): number {
  if (!auto || !frame.w || !frame.h) return ratio;
  // 가로 프레임에서 세로 비율(9:16)을 고른 경우는 사용자의 의도이므로 그대로 둔다.
  if (frame.h > frame.w && ratio > 1) return 1 / ratio;
  return ratio;
}

let shared: AudioContext | null = null;

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** 앱 전체가 함께 쓰는 AudioContext(iOS 는 동시에 만들 수 있는 개수가 적다). */
export function getSharedAudioContext(): AudioContext | null {
  if (shared && shared.state !== 'closed') return shared;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    shared = new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      shared = new Ctor();
    } catch {
      shared = null;
    }
  }
  return shared;
}

/**
 * 버튼 클릭 같은 사용자 동작 안에서 '동기적으로' 호출해야 한다.
 * iOS Safari 는 사용자 동작 밖에서 만든 AudioContext 를 계속 일시정지 상태로 둔다.
 */
export function unlockAudio(): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    // 구형 iOS 는 무음 버퍼를 한 번 재생해야 오디오가 활성화된다.
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* 무시 */
  }
}

/** 카메라·마이크 사용 종료 시 오디오 자원도 해제한다. 다음 시작 때 다시 만든다. */
export function releaseSharedAudioContext(): void {
  if (shared && shared.state !== 'closed') void shared.close().catch(() => undefined);
  shared = null;
}

/** OS 공유 시트(아이폰 '비디오 저장'/'이미지 저장', 안드로이드 갤러리 저장)를 쓸 수 있는지 */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
