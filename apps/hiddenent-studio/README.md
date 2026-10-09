# Hiddenent Video & Photo Studio

브라우저에서 실행되는 **동영상·사진 통합 촬영 웹앱**입니다. 카메라·마이크 선택, 실시간 미리보기, L/R dBFS 오디오 레벨 미터,
동영상 녹화(일시정지/재개), 사진 촬영(타이머·버스트·인터벌), 구도 가이드, 로컬 미디어 라이브러리를 실제 브라우저 미디어 API로
구현했습니다. 촬영한 미디어는 **기기 밖으로 전송되지 않습니다.**

- 기술: React 18 + TypeScript + Vite (런타임 의존성: `react`, `react-dom`, `fflate`(ZIP), `fix-webm-duration`)
- 사용 API: `getUserMedia` / `enumerateDevices` / `MediaRecorder` / Web Audio `AnalyserNode` / Canvas / `ImageCapture` / IndexedDB / StorageManager
- 테스트: 단위 36건(Vitest) + 실제 Chromium E2E 44건 **모두 통과** → [docs/TEST_REPORT.md](docs/TEST_REPORT.md)

![데스크톱 동영상 모드](docs/screenshots/desktop-video.png)

---

## 1. 설치 및 실행

요구 사항: Node.js 18 이상(20/22 권장), 최신 Chrome·Edge·Firefox·Safari.

```bash
cd apps/hiddenent-studio
npm install
npm run dev            # http://localhost:5173  (localhost 는 보안 컨텍스트라 카메라 사용 가능)
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버(HMR) |
| `npm run dev:https` | 자체 서명 인증서 HTTPS 개발 서버 — 같은 Wi-Fi 의 휴대폰에서 `https://<PC IP>:5173` 으로 테스트 |
| `npm run build` | 타입 검사 + 프로덕션 빌드(`dist/`) |
| `npm run preview` / `preview:https` | 빌드 결과 미리보기 |
| `npm test` | 단위 테스트(Vitest) |
| `npm run test:e2e` | 빌드 결과를 Chromium 가짜 장치로 E2E 검증(`npm run build` 먼저). `CHROMIUM_PATH` 로 브라우저 지정 |

> 카메라·마이크 API는 **HTTPS 또는 localhost** 에서만 동작합니다. `http://192.168.x.x` 같은 주소로 열면 앱이 "보안 연결(HTTPS)이
> 필요합니다" 안내를 표시합니다.

## 2. HTTPS 배포

빌드 결과(`dist/`)는 정적 파일이므로 어떤 HTTPS 정적 호스팅에도 올릴 수 있습니다(`base: './'` 로 하위 경로 배포 가능).

```bash
npm run build      # dist/ 생성
```

- **Netlify / Vercel / Cloudflare Pages**: 빌드 명령 `npm run build`, 출력 디렉터리 `dist`, 루트 `apps/hiddenent-studio`. HTTPS 자동.
- **GitHub Pages**: `dist/` 내용을 `gh-pages` 브랜치에 배포(HTTPS 자동).
- **Nginx 직접 운영** (Let's Encrypt 인증서):

```nginx
server {
  listen 443 ssl http2;
  server_name studio.example.com;
  ssl_certificate     /etc/letsencrypt/live/studio.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/studio.example.com/privkey.pem;
  root /var/www/hiddenent-studio/dist;
  index index.html;

  # 카메라·마이크를 이 출처에서만 허용
  add_header Permissions-Policy "camera=(self), microphone=(self), display-capture=()" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
  location / { try_files $uri /index.html; }
}
server { listen 80; server_name studio.example.com; return 301 https://$host$request_uri; }
```

- iframe 에 삽입할 경우 `<iframe src="..." allow="camera; microphone">` 가 필요합니다.
- 프로덕션 빌드의 `index.html` 에는 CSP(`connect-src 'self' blob:`)가 들어가 외부 서버로의 데이터 전송 경로를 차단합니다.

## 3. 폴더 구조

```
apps/hiddenent-studio/
├── index.html                 # 앱 셸
├── vite.config.ts             # Vite 설정(HTTPS 모드, 프로덕션 CSP 주입, Vitest)
├── public/favicon.svg
├── src/
│   ├── main.tsx / App.tsx     # 진입점, 레이아웃·메뉴·단축키·페이지 이탈 처리
│   ├── StudioContext.ts       # 화면 간 공유 상태
│   ├── core/                  # 프레임워크 독립 로직(대부분 순수 함수, 단위 테스트 대상)
│   │   ├── devices.ts         # 장치 목록, 제약 조건, getUserMedia 오류 → 한국어 안내
│   │   ├── audioLevel.ts      # RMS/피크 → dBFS, 구간 분류, 미터 탄도(피크 홀드)
│   │   ├── audioMeterEngine.ts# AudioContext + ChannelSplitter + AnalyserNode(L/R), 복제 트랙 분석
│   │   ├── codecs.ts          # MediaRecorder 코덱 런타임 탐지, 이미지 형식 탐지
│   │   ├── recorder.ts        # MediaRecorder 래퍼(청크 수집, 일시정지 시간 제외, WebM 길이 보정)
│   │   ├── canvasPipeline.ts  # 비율 자르기·디지털 확대·파일 반전 녹화용 캔버스 스트림
│   │   ├── photo.ts           # 사진 캡처(Canvas/ImageCapture), 회전·자르기·워터마크·날짜
│   │   ├── colorMatrix.ts     # 밝기·대비·채도·색온도·효과 → 4x5 색 행렬(미리보기=SVG, 저장=픽셀 동일)
│   │   ├── storage.ts         # IndexedDB 라이브러리, 용량 확인, 영구 보존 요청
│   │   ├── download.ts        # 사용자 동작 기반 다운로드, ZIP 묶기
│   │   ├── settings.ts / format.ts / countdown.ts / sound.ts / capabilities.ts
│   ├── hooks/                 # useMediaSession, useAudioMeter, useVideoRecorder, usePhotoCapture,
│   │                          # useLibrary, useShortcuts, useToasts
│   ├── components/            # PreviewStage, AudioMeter, GuideOverlay, Histogram, Panels, ControlBar,
│   │                          # Library, MediaViewer, PhotoEditor, CompareSlider, SettingsPage, HelpPage, ui
│   └── styles/app.css         # 다크 스튜디오 테마, 반응형(1100px / 760px 분기)
├── tests/
│   ├── unit/core.test.ts      # Vitest
│   └── e2e/run-e2e.mjs        # Playwright-core + 가짜 미디어 장치 E2E
└── docs/
    ├── TEST_REPORT.md         # 테스트 결과
    └── screenshots/
```

## 4. 핵심 설계

**스트림 구조**

```
getUserMedia(video) ──► 카메라 트랙 ──┬──► <video> 미리보기 (CSS 반전·확대·색 행렬 필터)
                                      ├──► MediaRecorder (직접 녹화, 최고 품질)
                                      └──► CanvasPipeline ──► captureStream ──► MediaRecorder
                                           (비율 자르기 / 디지털 확대 / 파일 좌우 반전이 필요할 때만)

getUserMedia(audio) ──► 마이크 트랙(녹음용, 음소거=track.enabled=false) ──► MediaRecorder
                        └─ track.clone() ──► AudioContext ─ Splitter ─ Analyser L/R (destination 미연결)
```

- 녹음 트랙과 분석 트랙을 분리해 **분석 때문에 녹음이 변형·중복되지 않고**, 분석 실패가 녹화에 영향을 주지 않습니다.
- 분석 그래프는 `destination` 에 연결하지 않으므로 **스피커로 소리가 나가지 않습니다**(하울링 방지).
- 장치·설정 변경 시 기존 트랙을 먼저 `stop()` 한 뒤 새 스트림을 엽니다. 요청 순번으로 늦게 도착한 응답을 폐기합니다.
- 녹화 중에는 장치·해상도 등 설정과 메뉴 이동을 잠가 파일 손상을 막습니다.
- `MediaRecorder.start(1000)` 으로 1초마다 청크를 받아, 장치 분리·오류 시에도 그 시점까지 저장합니다.

**오디오 미터**: `getFloatTimeDomainData` 2048 샘플 → 채널별 RMS·샘플 피크 → `20·log10` dBFS
(1e-6 이하 = 디지털 무음 `-∞`). 막대는 피크 기반(즉시 상승, 24 dB/s 하강), 숫자는 RMS(약 300 ms 평활)와 피크 홀드.
구간: `<-70` 무신호 · `-70~-40` 낮음 · `-40~-12` 적정 · `-12~-3` 높음 · `≥-3` 클리핑 위험(색상 + 텍스트 동시 표시).
모노 마이크는 L/R 을 같은 값으로 표시하고 "모노 입력"이라고 명시합니다.

## 5. 기능별 구현 현황

범례: ✅ 구현·자동 검증 / ☑️ 구현(수동 확인 필요 또는 브라우저 지원 시) / ⚠️ 부분·대체 구현 / ❌ 미지원(사유 표시)

| 영역 | 기능 | 상태 | 비고 |
|---|---|---|---|
| 장치 | 카메라 목록·선택·상태 표시 | ✅ | 권한 전후 재탐색, `devicechange` 감지 |
| | 전면/후면 전환 | ☑️ | `facingMode` 지원 시 전환, 아니면 다음 카메라로 순환 |
| | 장치 변경 시 안전한 재연결 | ✅ | 이전 트랙 종료 확인(E2E) |
| | 권한 거부·미연결·사용 중 오류 안내 | ✅ | 원인 + 해결 방법(한국어), 재시도 버튼 |
| 마이크 | 마이크 드롭다운, 실제 녹음 스트림 연결 | ✅ | |
| | 변경 시 녹음 트랙·분석기 재구성 | ✅ | |
| | 음소거 / 녹음 포함 여부 | ✅ | 음소거 시 무음 기록 검증(피크 0) |
| | 에코 제거·노이즈 억제·AGC | ✅ | 브라우저 미지원 시 비활성, 실제 적용 값(`getSettings`)을 "적용됨/요청과 다름"으로 표시 |
| | 샘플 레이트·채널 수·지연 표시 | ✅ | 브라우저가 제공하지 않으면 "확인 불가" |
| 오디오 미터 | L/R dBFS, 움직이는 막대, 색 구간, 피크 홀드·초기화, 무신호 표시 | ✅ | L -15/R -27 dBFS 측정(입력 -12/-24 dBFS 피크 사인파) |
| | 모니터링 켜기/끄기, 스피커 미출력 | ✅ | |
| 동영상 | 해상도 4K/1440p/1080p/720p/480p, 프레임 24~60 | ✅ | 장치 최대값 초과 옵션은 "장치 미지원" 비활성, 실제 적용 값 표시 |
| | 화면 비율 16:9 / 9:16 / 4:3 / 1:1 | ✅ | 카메라가 직접 제공 못 하면 캔버스 자르기 녹화 |
| | 품질·비트레이트 | ✅ | 목표값 전달, 녹화 후 실제 평균 비트레이트 기록 |
| | 지원 컨테이너·코덱 표시, 자동 선택 | ✅ | `isTypeSupported` 결과만 표시 |
| | 녹화/일시정지/재개/종료/취소(확인) | ✅ | 일시정지 미지원 브라우저는 버튼 비활성 + 사유 |
| | 시간 제한, 경과·남은 시간, REC 표시 | ✅ | |
| | 카운트다운 3/5/10초 | ✅ | Esc 취소 |
| | 미리보기·파일 좌우 반전, 확대·축소 | ✅ | 하드웨어 줌 지원 시 카메라 줌, 아니면 디지털 확대(녹화 시 캔버스로 반영) |
| | 파일명 템플릿 | ✅ | `{date} {time} {type} {seq}` |
| | 촬영 전후 프레임 비교 | ✅ | 녹화 시작/종료 프레임 슬라이더 비교 |
| 촬영 보조 | 십자선·삼분할·황금비·안전영역·수평선, 히스토그램 | ✅ | G 로 전체 토글 |
| 사진 | 촬영(Space), 타이머, 버스트, 인터벌 | ✅ | |
| | JPEG/PNG/WebP + 품질 | ✅ | 실제 생성 가능한 형식만 표시 |
| | 원본 해상도 캡처 | ☑️ | `ImageCapture.takePhoto`(Chromium), 실패 시 프레임 캡처로 대체 |
| | 밝기·대비·채도·색온도, 흑백·세피아 등 | ✅ | 미리보기와 저장 결과가 같은 색 행렬 사용 |
| | 날짜·워터마크, 회전 보정, 저장 반전 | ✅ | |
| | 촬영 후 회전·자르기 | ✅ | 드래그/키보드 자르기, 비율 고정 |
| | 하드웨어 노출·초점·화이트밸런스·토치 | ☑️ | `getCapabilities()` 가 노출한 항목만 표시, 없으면 "미지원" |
| | 손떨림 보정 상태 | ❌ | 웹 표준 API 없음 → "확인 불가(미지원)"로 명시 |
| | 전후 비교, 파일 크기 표시 | ✅ | |
| 라이브러리 | 통합 목록, 필터, 정렬, 메타데이터, 재생·확대 | ✅ | |
| | 이름 변경, 삭제(확인), 다중 선택, 개별/ZIP 일괄 다운로드 | ✅ | |
| | IndexedDB 로컬 보관, 임시/저장 구분, 용량 표시, 영구 보존 요청 | ✅ | 새로고침 후 유지 검증 |
| UI | 반응형(데스크톱/태블릿/모바일), 패널 접기, 녹화 중 자동 접기 | ✅ | |
| | 접근성(키보드, 포커스 트랩, aria, 색+텍스트 상태) | ✅ | |
| 단축키 | Space / V / P / M / G / Esc, 입력 중 무시, 반복 입력 무시 | ✅ | 녹화 중 모드 전환 차단, Esc 는 확인 창만 엶 |
| 안정성 | 장치 분리 시 자동 저장, 탭 비활성 경고, 페이지 이탈 경고, 저장 공간 부족 안내 | ✅ | 장치 분리는 `ended` 이벤트로 시뮬레이션 검증 |
| 보안 | 시작 버튼 전 장치 미접근, 사용 중 표시, 종료 시 트랙·AudioContext 정리, 외부 전송 없음(CSP) | ✅ | |

## 6. 브라우저별 제약 사항

| 항목 | Chrome / Edge | Firefox | Safari (macOS/iOS) |
|---|---|---|---|
| 녹화 형식 | WebM(VP9/VP8+Opus) 기본. 일부 빌드는 MP4(H.264) 지원 | WebM(VP8/VP9+Opus) | MP4(H.264+AAC) |
| WebM 길이 메타데이터 | 없음 → 앱이 저장 시 보정 | 대체로 포함 | 해당 없음 |
| `getCapabilities()` | 지원 | 일부 버전 미지원 → 해상도 옵션을 전부 표시하고 실제 적용 값으로 안내 | 지원 |
| ImageCapture | 지원 | 미지원(프레임 캡처) | 미지원(프레임 캡처) |
| 하드웨어 노출/초점/토치 | 장치에 따라 일부(주로 Android) | 미지원 | 대부분 미지원 |
| AGC/NS/EC 끄기 | 지원 | 지원 | 일부 무시될 수 있음(실제 값 표시) |
| 마이크 채널·샘플레이트 보고 | 지원 | 일부 | 일부 → "확인 불가" 표시 |
| 탭 백그라운드 | 직접 녹화는 계속, 캔버스 녹화는 프레임 정지 가능 | 동일 | iOS 는 백그라운드에서 카메라 중단 |
| 연속 다운로드 | 첫 실행 시 "여러 파일 다운로드" 허용 요청 | 확인 창 | iOS 는 `download` 속성 제한 → ZIP 권장 |

## 7. 알려진 문제

- **캔버스 처리 녹화**(비율 자르기·디지털 확대·파일 반전)는 탭이 백그라운드로 가면 영상 프레임이 멈출 수 있습니다(앱이 경고).
- 녹화 중 마이크/카메라 **교체는 지원하지 않습니다**(MediaRecorder 는 녹화 중 트랙 교체 불가). 장치가 분리되면 그 시점까지 저장하고 안내합니다.
- 비트레이트는 브라우저가 목표값으로만 사용합니다. 실제 평균 비트레이트를 라이브러리 정보에 표시합니다.
- 프레임 레이트는 카메라 보고값이며, 저장 파일의 실제 프레임 수는 조명·CPU 부하에 따라 낮아질 수 있습니다.
- 라이브러리의 ZIP·로컬 보관은 파일 전체를 메모리에 올리므로 매우 큰 동영상(수 GB)은 개별 다운로드를 권장합니다.
- 브라우저는 OS 장치 이름만 제공하므로 장치 목록에는 브라우저가 보고한 이름을 그대로 보여줍니다(물리 장치 매핑을 추정하지 않음).
- E2E 는 Chromium 가짜 장치로 수행했으며, 실제 USB 장치·모바일 기기 검증은 [체크리스트](docs/TEST_REPORT.md#실기기-검증-체크리스트-배포-후-수행-권장)로 남겨 두었습니다.

## 8. 향후 개선

1. 녹화 중 마이크 전환(Web Audio 믹싱 경로 + 무손실 옵션) 및 다중 마이크 동시 녹음
2. WebCodecs 기반 녹화(정확한 프레임 레이트·키프레임 제어, MP4 muxing)
3. 오디오 LUFS(라우드니스) 측정, 녹음 전 테스트 녹음/재생
4. OPFS(Origin Private File System) 스트리밍 저장으로 장시간 녹화의 메모리 사용 절감
5. PWA(오프라인 설치), 기기 기울기(DeviceOrientation) 기반 수평계
6. 화면 녹화(getDisplayMedia) + 카메라 PIP 합성
7. 사용자 동의 기반 공유(Web Share API) — 현재는 외부 전송 기능을 의도적으로 제외
8. 다국어(i18n) 및 라이트 테마

---

Powered by **Hiddenent**
