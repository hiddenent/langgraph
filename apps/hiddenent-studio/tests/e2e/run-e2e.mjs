// Hiddenent Video & Photo Studio — 실제 브라우저 E2E 검증
//
// Chromium 의 가짜 미디어 장치(--use-fake-device-for-media-stream)로 실제 getUserMedia,
// MediaRecorder, Web Audio, Canvas, IndexedDB, 다운로드 경로를 그대로 실행한다.
// 생성된 동영상/사진 파일은 바이트 시그니처, 재생 가능 여부, 오디오 디코딩까지 확인한다.
//
// 사용법: npm run build && npm run test:e2e
//   CHROMIUM_PATH 환경 변수로 브라우저 경로를 지정할 수 있다(기본: Playwright 설치 경로).

import { chromium } from 'playwright-core';
import { preview } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// ---------- 테스트 오디오 파일(WAV) 생성 ----------
function writeWav(file, seconds, channels, gen) {
  const rate = 48000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * channels * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, gen(i / rate, c)));
      data.writeInt16LE(Math.round(v * 32767), (i * channels + c) * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
const toneWav = path.join(OUT, 'tone-stereo.wav');
const silentWav = path.join(OUT, 'silence.wav');
// 왼쪽 -12 dBFS(진폭 0.25), 오른쪽 -24 dBFS(진폭 0.063) 의 1 kHz 사인파 → L/R 미터 분리 확인
writeWav(toneWav, 4, 2, (t, c) => (c === 0 ? 0.251 : 0.063) * Math.sin(2 * Math.PI * 1000 * t));
writeWav(silentWav, 2, 1, () => 0);

// ---------- 결과 수집 ----------
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`• ${name} ... `);
  try {
    const detail = (await fn()) ?? '';
    results.push({ name, ok: true, ms: Date.now() - t0, detail: String(detail) });
    console.log(`OK ${detail ? `(${detail})` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message.split('\n')[0] : String(e) });
    console.log(`FAIL — ${e instanceof Error ? e.message : e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 미디어 자원 추적용 계측(앱 코드는 수정하지 않음)
const INSTRUMENT = () => {
  window.__gum = [];
  window.__clones = [];
  window.__ctx = [];
  const og = MediaDevices.prototype.getUserMedia;
  MediaDevices.prototype.getUserMedia = async function (c) {
    const s = await og.call(this, c);
    s.getTracks().forEach((t) => window.__gum.push(t));
    return s;
  };
  const oc = MediaStreamTrack.prototype.clone;
  MediaStreamTrack.prototype.clone = function () {
    const t = oc.call(this);
    window.__clones.push(t);
    return t;
  };
  const os = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (s) {
    window.__ctx.push(this);
    return os.call(this, s);
  };
};

// 페이지 안에서 녹화 파일을 분석한다(시그니처·길이·재생·오디오 디코딩).
const ANALYZE_VIDEO = async (src) => {
  const buf = await (await fetch(src)).arrayBuffer();
  const head = Array.from(new Uint8Array(buf.slice(0, 4))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const v = document.createElement('video');
  v.muted = true;
  v.src = src;
  await new Promise((res, rej) => {
    v.onloadedmetadata = res;
    v.onerror = () => rej(new Error('media error ' + (v.error && v.error.code)));
  });
  const duration = v.duration;
  await v.play();
  await new Promise((r) => setTimeout(r, 600));
  const playedTo = v.currentTime;
  v.pause();
  let audio;
  try {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const ab = await ctx.decodeAudioData(buf.slice(0));
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < d.length; i += 7) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sum += d[i] * d[i];
        n++;
      }
    }
    audio = { channels: ab.numberOfChannels, duration: ab.duration, peak, rms: Math.sqrt(sum / Math.max(1, n)) };
  } catch (e) {
    audio = { error: String(e && e.message) };
  }
  return { size: buf.byteLength, head, duration, w: v.videoWidth, h: v.videoHeight, playedTo, audio };
};

const ANALYZE_IMAGE = async (src) => {
  const buf = await (await fetch(src)).arrayBuffer();
  const head = Array.from(new Uint8Array(buf.slice(0, 4))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let maxChromaDiff = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    maxChromaDiff = Math.max(maxChromaDiff, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]));
  }
  return { size: buf.byteLength, head, w: img.naturalWidth, h: img.naturalHeight, maxChromaDiff };
};

async function launch(extraArgs) {
  return chromium.launch({
    executablePath: EXE,
    args: ['--autoplay-policy=no-user-gesture-required', ...extraArgs],
  });
}

const parseDb = (s) => (s.trim() === '-∞' ? -Infinity : parseFloat(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = await preview({ root: ROOT, preview: { port: 4180, strictPort: false, host: '127.0.0.1' }, logLevel: 'silent' });
  const base = server.resolvedUrls.local[0];
  console.log(`서버: ${base}\n브라우저: ${EXE ?? 'playwright 기본'}\n`);

  // ================= 브라우저 A: 가짜 카메라 2대 + 스테레오 톤 입력 =================
  const A = await launch([
    '--use-fake-device-for-media-stream=device-count=2,fps=30',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${toneWav}`,
  ]);
  const ctx = await A.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  let sawBeforeUnload = false;
  page.on('dialog', async (d) => {
    if (d.type() === 'beforeunload') {
      sawBeforeUnload = true;
      await d.accept();
    } else await d.dismiss();
  });
  await page.goto(base);

  const closeModals = async () => {
    for (let i = 0; i < 4; i++) {
      if ((await page.locator('.modal').count()) === 0) break;
      await page.keyboard.press('Escape');
      await sleep(150);
    }
  };
  const itemCount = async () =>
    page.evaluate(() => {
      const t = [...document.querySelectorAll('[data-testid="nav-library"], .thumbs .btn')].map((e) => e.textContent).join(' ');
      const m = t.match(/라이브러리 \((\d+)\)/);
      return m ? Number(m[1]) : -1;
    });
  const recordFor = async (ms) => {
    await page.getByTestId('record-start').click();
    await page.getByTestId('rec-indicator').waitFor({ timeout: 5000 });
    await sleep(ms);
    await page.getByTestId('record-stop').click();
    await page.getByTestId('review-card').waitFor({ timeout: 10000 });
    await page.getByTestId('record-start').waitFor({ timeout: 10000 });
  };
  const analyzeLatestVideo = async () => {
    await page.getByTestId('review-card').getByRole('button', { name: '재생', exact: true }).click();
    const v = page.getByTestId('viewer-video');
    await v.waitFor();
    const src = await v.getAttribute('src');
    const info = await page.evaluate(ANALYZE_VIDEO, src);
    const meta = await page.getByTestId('media-viewer').locator('.viewer__info').innerText();
    return { ...info, meta };
  };

  await test('브랜드 표기: Hiddenent / Video & Photo Studio / Powered by Hiddenent', async () => {
    assert((await page.title()).includes('Hiddenent'), 'title');
    assert(await page.locator('.brand').getByText('Hiddenent').isVisible(), 'logo');
    assert(await page.getByText('Video & Photo Studio').first().isVisible(), 'product');
    assert(await page.locator('.footer').getByText('Hiddenent').isVisible(), 'footer');
  });

  await test('권한 요청 전에는 카메라·마이크에 접근하지 않음', async () => {
    const n = await page.evaluate(() => window.__gum.length);
    assert(n === 0, `getUserMedia 호출됨: ${n}`);
    assert((await page.getByTestId('cam-indicator').innerText()).includes('꺼짐'), '표시');
  });

  await test('카메라·마이크 시작 → 실시간 미리보기 표시', async () => {
    await page.getByTestId('start-devices').click();
    await page.getByTestId('actual-resolution').waitFor({ timeout: 10000 });
    const vw = await page.getByTestId('preview-video').evaluate((v) => v.videoWidth);
    assert(vw > 0, 'videoWidth 0');
    assert((await page.getByTestId('cam-indicator').innerText()).includes('사용 중'), 'cam indicator');
    await page.waitForFunction(() => document.querySelector('[data-testid="mic-indicator"]').textContent.includes('사용 중'));
    return `실제 ${await page.getByTestId('actual-resolution').innerText()}`;
  });

  await test('카메라 목록 표시(권한 후 장치 이름 포함)', async () => {
    const opts = await page.getByTestId('camera-select').first().locator('option').allInnerTexts();
    assert(opts.length >= 2, `cameras=${opts.length}`);
    assert(opts.every((o) => o.startsWith('fake_device')), opts.join(','));
    return opts.join(', ');
  });

  await test('마이크 목록 표시(드롭다운)', async () => {
    const opts = await page.getByTestId('mic-select').first().locator('option').allInnerTexts();
    assert(opts.length >= 3, `mics=${opts.length}`);
    return opts.join(', ');
  });

  await test('카메라 변경 시 기존 트랙 종료 후 미리보기가 새 장치로 전환', async () => {
    const before = await page.getByTestId('preview-video').evaluate((v) => {
      window.__oldVideoTrack = v.srcObject.getVideoTracks()[0];
      return window.__oldVideoTrack.getSettings().deviceId;
    });
    const options = await page.getByTestId('camera-select').first().locator('option').evaluateAll((os) => os.map((o) => o.value));
    const target = options.find((o) => o !== before);
    await page.getByTestId('camera-select').first().selectOption(target);
    await page.waitForFunction(
      (id) => {
        const v = document.querySelector('[data-testid="preview-video"]');
        return v.srcObject && v.srcObject.getVideoTracks()[0].getSettings().deviceId === id && v.videoWidth > 0;
      },
      target,
      { timeout: 10000 },
    );
    const oldState = await page.evaluate(() => window.__oldVideoTrack.readyState);
    assert(oldState === 'ended', `old track ${oldState}`);
    return `${before.slice(0, 6)}… → ${target.slice(0, 6)}… (이전 트랙 ${oldState})`;
  });

  await test('오디오 레벨 미터: dBFS 수치·L/R 채널·구간 표시 갱신', async () => {
    await sleep(1500);
    const L1 = parseDb(await page.getByTestId('meter-rms-L').innerText());
    const R1 = parseDb(await page.getByTestId('meter-rms-R').innerText());
    const pk = parseDb(await page.getByTestId('meter-peak-L').innerText());
    const zone = await page.getByTestId('meter-zone').getAttribute('data-zone');
    assert(Number.isFinite(L1) && L1 < 0 && L1 > -40, `L rms ${L1}`);
    assert(Number.isFinite(pk) && pk >= L1, `peak ${pk}`);
    assert(zone !== 'silent', `zone ${zone}`);
    await sleep(700);
    const L2 = await page.getByTestId('meter-rms-L').innerText();
    const max = parseDb(await page.getByTestId('meter-max').innerText());
    assert(Number.isFinite(max), 'max peak');
    return `L RMS ${L1} dBFS, R RMS ${R1} dBFS, L 피크 ${pk}, 최대 ${max}, 구간=${zone}, 재측정 L=${L2}`;
  });

  await test('피크 초기화 버튼', async () => {
    await page.getByTestId('meter-reset').click();
    const after = await page.getByTestId('meter-max').innerText();
    await sleep(500);
    const later = parseDb(await page.getByTestId('meter-max').innerText());
    assert(after.trim() === '-∞' || parseDb(after) <= later + 0.01, `reset ${after}`);
    assert(Number.isFinite(later), 'max not updating after reset');
    return `초기화 직후 ${after}, 0.5초 후 ${later}`;
  });

  await test('마이크 변경 시 녹음 트랙·분석기 재구성 및 미터 반응', async () => {
    const opts = await page.getByTestId('mic-select').first().locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
    const target = opts.find(([, l]) => l.includes('Input 1')) ?? opts[1];
    const clonesBefore = await page.evaluate(() => window.__clones.length);
    await page.getByTestId('mic-select').first().selectOption(target[0]);
    await page.waitForFunction(
      (id) => window.__gum.filter((t) => t.kind === 'audio' && t.readyState === 'live').some((t) => t.getSettings().deviceId === id),
      target[0],
      { timeout: 10000 },
    );
    await sleep(1500);
    const st = await page.evaluate(() => ({
      liveAudio: window.__gum.filter((t) => t.kind === 'audio' && t.readyState === 'live').length,
      clones: window.__clones.length,
      liveClones: window.__clones.filter((t) => t.readyState === 'live').length,
    }));
    const L = parseDb(await page.getByTestId('meter-rms-L').innerText());
    assert(st.liveAudio === 1, `live audio tracks ${st.liveAudio}`);
    assert(st.clones > clonesBefore && st.liveClones === 1, `clones ${JSON.stringify(st)}`);
    assert(Number.isFinite(L), 'meter not reacting');
    return `${target[1]} 선택, 활성 녹음 트랙 1개, 분석용 복제 트랙 1개, L=${L} dBFS`;
  });

  await test('지원하지 않는 프레임 레이트는 비활성화(잘못된 성공 표시 없음)', async () => {
    const opts = await page.getByTestId('video-fps').locator('option').evaluateAll((os) => os.map((o) => [o.textContent, o.disabled]));
    const disabled = opts.filter(([, d]) => d).map(([t]) => t);
    assert(disabled.length > 0 && disabled.every((t) => t.includes('장치 미지원')), JSON.stringify(opts));
    await page.getByTestId('video-fps').selectOption('30');
    const applied = await page.getByTestId('applied-video').innerText();
    return `비활성: ${disabled.join(', ')} / ${applied}`;
  });

  await test('하드웨어 제어: 브라우저가 노출한 항목만 표시', async () => {
    await page.getByRole('button', { name: /카메라 하드웨어 제어/ }).click();
    const panelText = await page.locator('.side--right').innerText();
    assert(panelText.includes('노출 모드') || panelText.includes('초점'), 'hw controls not shown');
    assert(panelText.includes('손떨림 보정'), 'stabilization note');
    await page.getByRole('button', { name: /카메라 하드웨어 제어/ }).click();
    return '노출/초점 모드 표시, 손떨림 보정은 "확인 불가(미지원)" 안내';
  });

  let videoCount = 0;
  await test('동영상 녹화(3초, 오디오 포함) → 재생 가능한 파일 생성', async () => {
    await recordFor(3000);
    const r = await analyzeLatestVideo();
    videoCount++;
    assert(r.head === '1a45dfa3' || r.head.endsWith('66747970') || r.size > 0, `signature ${r.head}`);
    assert(Number.isFinite(r.duration) && r.duration > 2 && r.duration < 4.5, `duration ${r.duration}`);
    assert(r.playedTo > 0, 'not playable');
    assert(!r.audio.error && r.audio.peak > 0.02, `audio ${JSON.stringify(r.audio)}`);
    return `${r.size} bytes, sig=${r.head}, ${r.w}×${r.h}, 길이 ${r.duration.toFixed(2)}s, 재생 ${r.playedTo.toFixed(2)}s, 오디오 ${r.audio.channels}ch 피크 ${r.audio.peak.toFixed(3)}`;
  });

  await test('동영상 파일 다운로드', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('viewer-download').click()]);
    const p = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(p);
    const b = fs.readFileSync(p);
    assert(b.length > 1000, 'too small');
    assert(b.subarray(0, 4).toString('hex') === '1a45dfa3' || b.subarray(4, 8).toString() === 'ftyp', 'signature');
    await closeModals();
    return `${dl.suggestedFilename()} (${b.length} bytes)`;
  });

  await test('녹화 일시정지/재개(일시정지 구간 제외)', async () => {
    await page.getByTestId('record-start').click();
    await page.getByTestId('rec-indicator').waitFor();
    await sleep(1200);
    await page.getByTestId('record-pause').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="rec-indicator"]').textContent.includes('일시정지'));
    const t1 = await page.getByTestId('rec-elapsed').innerText();
    await sleep(2000);
    const t2 = await page.getByTestId('rec-elapsed').innerText();
    assert(t1 === t2, `elapsed moved while paused ${t1}→${t2}`);
    await page.getByTestId('record-pause').click();
    await sleep(1200);
    await page.getByTestId('record-stop').click();
    await page.getByTestId('record-start').waitFor({ timeout: 10000 });
    const r = await analyzeLatestVideo();
    videoCount++;
    await closeModals();
    assert(r.duration > 1.8 && r.duration < 3.4, `duration ${r.duration} (wall ≈4.4s)`);
    return `일시정지 중 경과시간 고정(${t1}), 파일 길이 ${r.duration.toFixed(2)}s (실제 경과 약 4.4s)`;
  });

  await test('Space 단축키로 녹화 시작/종료', async () => {
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    const n0 = await itemCount();
    await page.keyboard.press('Space');
    await page.getByTestId('rec-indicator').waitFor({ timeout: 5000 });
    await sleep(1500);
    await page.keyboard.press('Space');
    await page.getByTestId('record-start').waitFor({ timeout: 10000 });
    await page.waitForFunction((n) => {
      const t = document.querySelector('.thumbs .btn')?.textContent ?? '';
      return Number((t.match(/\((\d+)\)/) || [])[1]) === n + 1;
    }, n0);
    videoCount++;
    return `항목 ${n0} → ${n0 + 1}`;
  });

  await test('시작 직후 바로 정지해도 파일 생성(첫 데이터 대기)', async () => {
    const n0 = await itemCount();
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('record-start').click();
      await page.getByTestId('record-stop').click();
      await page.getByTestId('record-start').waitFor({ timeout: 15000 });
    }
    await page.waitForFunction(
      (n) => Number(((document.querySelector('.thumbs .btn')?.textContent ?? '').match(/\((\d+)\)/) || [])[1]) === n + 3,
      n0,
      { timeout: 5000 },
    );
    videoCount += 3;
    await closeModals();
    return `즉시 정지 3회 → 파일 3개 (항목 ${n0} → ${n0 + 3})`;
  });

  await test('입력창 편집 중에는 단축키 무시', async () => {
    const input = page.getByLabel('저장 파일명 템플릿');
    await input.click();
    await input.press('End');
    await page.keyboard.type('p');
    const section = await page.locator('.app').getAttribute('data-section');
    const val = await input.inputValue();
    assert(section === 'video', `section ${section}`);
    assert(val.endsWith('p'), 'typed');
    await input.press('Backspace');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    return '입력창에 p 입력 → 모드 전환 안 됨';
  });

  await test('Esc: 녹화 중 확인 대화상자 → 녹화 취소(파일 미생성)', async () => {
    const n0 = await itemCount();
    await page.getByTestId('record-start').click();
    await page.getByTestId('rec-indicator').waitFor();
    await sleep(800);
    await page.keyboard.press('Escape');
    await page.getByTestId('confirm-dialog').waitFor();
    assert(await page.getByTestId('rec-indicator').isVisible(), '녹화가 계속되어야 함');
    await page.getByTestId('confirm-ok').click();
    await page.getByTestId('record-start').waitFor();
    await sleep(500);
    const n1 = await itemCount();
    assert(n1 === n0, `items ${n0}→${n1}`);
    return '확인 전까지 녹화 유지, 취소 후 파일 없음';
  });

  await test('녹화 전 카운트다운(3초) 표시 및 Esc 취소', async () => {
    await page.getByRole('radiogroup', { name: '녹화 전 카운트다운' }).getByRole('radio', { name: '3초' }).click();
    await page.getByTestId('record-start').click();
    await page.getByTestId('countdown').waitFor();
    const txt = await page.getByTestId('countdown').innerText();
    await page.keyboard.press('Escape');
    await page.getByTestId('countdown').waitFor({ state: 'detached' });
    await sleep(3200);
    assert(!(await page.getByTestId('rec-indicator').isVisible()), '취소 후 녹화되면 안 됨');
    await page.getByRole('radiogroup', { name: '녹화 전 카운트다운' }).getByRole('radio', { name: '없음' }).click();
    return `카운트다운 표시 "${txt.split('\n')[0]}" → Esc 로 취소`;
  });

  await test('화면 비율 1:1 → 정사각 파일 생성(카메라가 지원하면 원본, 아니면 캔버스 자르기)', async () => {
    await page.getByRole('radiogroup', { name: '화면 비율' }).getByRole('radio', { name: '1:1' }).click();
    await page.getByTestId('actual-resolution').waitFor();
    await sleep(800);
    const plan = await page.getByTestId('record-plan').innerText();
    await recordFor(2000);
    const r = await analyzeLatestVideo();
    videoCount++;
    await closeModals();
    await page.getByRole('radiogroup', { name: '화면 비율' }).getByRole('radio', { name: '16:9' }).click();
    await page.getByTestId('actual-resolution').waitFor();
    assert(r.w === r.h && r.w > 0, `${r.w}x${r.h}`);
    return `${r.w}×${r.h} · ${plan.trim()}`;
  });

  await test('파일 좌우 반전 → 캔버스 처리 녹화 파이프라인', async () => {
    await page.getByText('녹화 파일도 좌우 반전').click();
    await sleep(300);
    const plan = await page.getByTestId('record-plan').innerText();
    await recordFor(2000);
    const r = await analyzeLatestVideo();
    videoCount++;
    await closeModals();
    await page.getByText('녹화 파일도 좌우 반전').click();
    assert(plan.includes('캔버스'), plan);
    assert(r.meta.includes('캔버스 처리 녹화'), r.meta);
    assert(r.duration > 1.4 && r.playedTo > 0 && r.w > 0, JSON.stringify(r));
    assert(!r.audio.error && r.audio.peak > 0.02, 'audio');
    return `${r.w}×${r.h}, 길이 ${r.duration.toFixed(2)}s, 오디오 포함 · ${plan.trim()}`;
  });

  await test('오디오 제외 녹화', async () => {
    await page.getByTestId('include-audio').first().uncheck({ force: true });
    await recordFor(1500);
    const r = await analyzeLatestVideo();
    videoCount++;
    await closeModals();
    await page.getByTestId('include-audio').first().check({ force: true });
    assert(r.meta.includes('오디오\n없음') || r.meta.includes('없음'), 'meta');
    assert(r.audio.error || r.audio.peak === 0, `audio present ${JSON.stringify(r.audio)}`);
    return `오디오 트랙 없음 (decode: ${r.audio.error ? '실패=트랙 없음' : 'peak 0'})`;
  });

  await test('M 단축키 음소거 → 녹음은 무음, 미터는 입력 표시', async () => {
    await page.keyboard.press('m');
    await page.waitForFunction(() => document.querySelector('[data-testid="mic-indicator"]').textContent.includes('음소거'));
    await recordFor(1500);
    const r = await analyzeLatestVideo();
    videoCount++;
    await closeModals();
    const L = parseDb(await page.getByTestId('meter-rms-L').innerText());
    await page.keyboard.press('m');
    await page.waitForFunction(() => document.querySelector('[data-testid="mic-indicator"]').textContent.includes('사용 중'));
    assert(!r.audio.error && r.audio.peak < 0.001, `muted audio peak ${JSON.stringify(r.audio)}`);
    assert(Number.isFinite(L), 'meter should still show input');
    return `녹음 피크 ${r.audio.peak.toFixed(5)}(무음), 미터 L=${L} dBFS`;
  });

  await test('녹화 시간 제한(15초) 도달 시 자동 저장', async () => {
    await page.getByLabel('녹화 시간 제한').selectOption('15');
    await page.getByTestId('record-start').click();
    await page.getByTestId('rec-indicator').waitFor();
    const remain = await page.locator('.rec-badge__remain').innerText();
    await page.getByTestId('record-start').waitFor({ timeout: 25000 });
    const toast = await page.getByTestId('toast').allInnerTexts();
    const r = await analyzeLatestVideo();
    videoCount++;
    await closeModals();
    await page.getByLabel('녹화 시간 제한').selectOption('0');
    assert(toast.some((t) => t.includes('시간 제한')), toast.join('|'));
    assert(r.duration > 14 && r.duration < 16.5, `duration ${r.duration}`);
    return `남은 시간 표시 "${remain}", 파일 길이 ${r.duration.toFixed(2)}s`;
  });

  await test('녹화 중 카메라 연결 해제(ended 이벤트 시뮬레이션) → 자동 저장·안내', async () => {
    const n0 = await itemCount();
    await page.getByTestId('record-start').click();
    await page.getByTestId('rec-indicator').waitFor();
    await sleep(1500);
    await page.getByTestId('preview-video').evaluate((v) => v.srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended')));
    await page.getByTestId('camera-error').waitFor({ timeout: 10000 });
    const err = await page.getByTestId('camera-error').innerText();
    await page.waitForFunction(
      (n) => Number(((document.querySelector('.thumbs .btn')?.textContent ?? '').match(/\((\d+)\)/) || [])[1]) === n + 1,
      n0,
      { timeout: 10000 },
    );
    videoCount++;
    const toasts = (await page.getByTestId('toast').allInnerTexts()).join(' | ');
    assert(err.includes('연결이 끊어졌습니다'), err);
    assert(toasts.includes('저장'), toasts);
    await page.getByRole('button', { name: '다시 연결' }).click();
    await page.getByTestId('actual-resolution').waitFor({ timeout: 10000 });
    return `안내 "${err.split('\n')[0]}" · 중단 시점까지 저장 · 다시 연결 성공`;
  });

  // ---------------- 사진 ----------------
  let photoSrcCount = 0;
  const shootAndAnalyze = async () => {
    await page.getByTestId('photo-shutter').click();
    await page.getByTestId('review-card').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="photo-shutter"]')?.disabled);
    await page.getByTestId('review-card').getByRole('button', { name: '보기', exact: true }).click();
    const img = page.getByTestId('viewer-image');
    await img.waitFor();
    const r = await page.evaluate(ANALYZE_IMAGE, await img.getAttribute('src'));
    photoSrcCount++;
    return r;
  };

  await test('P 단축키 → 사진 모드, 사진 촬영 및 미리보기', async () => {
    await page.keyboard.press('p');
    await page.waitForFunction(() => document.querySelector('.app').dataset.section === 'photo');
    await page.getByTestId('actual-resolution').waitFor();
    const r = await shootAndAnalyze();
    assert(r.head.startsWith('ffd8'), `jpeg sig ${r.head}`);
    assert(r.w > 0 && r.h > 0 && r.size > 1000, JSON.stringify(r));
    return `JPEG ${r.w}×${r.h}, ${r.size} bytes`;
  });

  await test('사진 파일 다운로드(JPEG)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('viewer-download').click()]);
    const p = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(p);
    const b = fs.readFileSync(p);
    assert(b[0] === 0xff && b[1] === 0xd8, 'jpeg signature');
    await closeModals();
    return `${dl.suggestedFilename()} (${b.length} bytes)`;
  });

  await test('PNG 형식 촬영', async () => {
    await page.getByTestId('photo-format').selectOption('image/png');
    const r = await shootAndAnalyze();
    await closeModals();
    await page.getByTestId('photo-format').selectOption('image/jpeg');
    assert(r.head === '89504e47', `png sig ${r.head}`);
    return `PNG ${r.w}×${r.h}, ${r.size} bytes`;
  });

  await test('원본 해상도 캡처(ImageCapture.takePhoto)', async () => {
    await page.getByText('원본 해상도 캡처(ImageCapture)').click();
    const r = await shootAndAnalyze();
    const meta = await page.getByTestId('media-viewer').locator('.viewer__info').innerText();
    await closeModals();
    await page.getByText('원본 해상도 캡처(ImageCapture)').click();
    assert(r.head.startsWith('ffd8') && r.w > 0, JSON.stringify(r));
    const used = meta.includes('ImageCapture.takePhoto') ? 'ImageCapture 사용' : '미리보기 프레임으로 대체';
    return `${r.w}×${r.h}, ${used}`;
  });

  await test('흑백 효과가 저장 사진 픽셀에 실제 적용', async () => {
    await page.getByRole('button', { name: /미리보기 보정/ }).click();
    await page.getByTestId('photo-effect').selectOption('mono');
    const filter = await page.getByTestId('preview-video').evaluate((v) => getComputedStyle(v).filter);
    const r = await shootAndAnalyze();
    await closeModals();
    await page.getByTestId('photo-effect').selectOption('none');
    assert(r.maxChromaDiff <= 3, `chroma ${r.maxChromaDiff}`);
    assert(filter.includes('url'), `preview filter ${filter}`);
    return `최대 채널 차 ${r.maxChromaDiff} (흑백), 미리보기 filter=${filter.slice(0, 30)}`;
  });

  await test('버스트 촬영(5장)', async () => {
    await page.getByRole('radiogroup', { name: '촬영 방식' }).getByRole('radio', { name: '버스트' }).click();
    const n0 = await itemCount();
    await page.getByTestId('photo-shutter').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast"]')].some((t) => t.textContent.includes('버스트 촬영 완료')), null, { timeout: 15000 });
    const n1 = await itemCount();
    await page.getByRole('radiogroup', { name: '촬영 방식' }).getByRole('radio', { name: '단일' }).click();
    assert(n1 - n0 === 5, `${n0}→${n1}`);
    return `${n1 - n0}장`;
  });

  await test('셀프 타이머 3초 촬영', async () => {
    await page.getByRole('radiogroup', { name: '셀프 타이머' }).getByRole('radio', { name: '3초' }).click();
    const n0 = await itemCount();
    const t0 = Date.now();
    await page.getByTestId('photo-shutter').click();
    await page.getByTestId('countdown').waitFor();
    await page.waitForFunction((n) => Number(((document.querySelector('.thumbs .btn')?.textContent ?? '').match(/\((\d+)\)/) || [])[1]) === n + 1, n0, { timeout: 8000 });
    const dt = Date.now() - t0;
    await page.getByRole('radiogroup', { name: '셀프 타이머' }).getByRole('radio', { name: '끔' }).click();
    assert(dt >= 2800, `too fast ${dt}`);
    return `${(dt / 1000).toFixed(1)}초 후 촬영`;
  });

  await test('촬영 후 편집: 90° 회전 적용', async () => {
    await page.getByTestId('thumb').first().click();
    const info0 = await page.getByTestId('media-viewer').locator('.viewer__info').innerText();
    const m0 = info0.match(/(\d+)×(\d+)/);
    await page.getByTestId('viewer-edit').click();
    await page.getByTestId('rotate-right').click();
    await page.getByTestId('editor-save').click();
    await page.getByTestId('photo-editor').waitFor({ state: 'detached' });
    await page.waitForFunction((w) => document.querySelector('.viewer__info').textContent.includes(`${w}×`), m0[2]);
    const info1 = await page.getByTestId('media-viewer').locator('.viewer__info').innerText();
    const m1 = info1.match(/(\d+)×(\d+)/);
    await closeModals();
    assert(m1[1] === m0[2] && m1[2] === m0[1], `${m0[0]} → ${m1[0]}`);
    return `${m0[0]} → ${m1[0]}`;
  });

  await test('G 단축키로 구도 가이드 표시/숨기기', async () => {
    const before = await page.getByTestId('guides').count();
    await page.keyboard.press('g');
    const after = await page.getByTestId('guides').count();
    await page.keyboard.press('g');
    assert(before === 1 && after === 0, `${before}/${after}`);
    return '표시 → 숨김 → 표시';
  });

  // ---------------- 라이브러리 ----------------
  await test('라이브러리: 사진/동영상 필터, 메타데이터 표시', async () => {
    await page.getByTestId('nav-library').click();
    await page.getByTestId('library').waitFor();
    const all = await page.getByTestId('library-card').count();
    await page.getByTestId('filter-photo').click();
    const photos = await page.getByTestId('library-card').count();
    await page.getByTestId('filter-video').click();
    const videos = await page.getByTestId('library-card').count();
    const sample = await page.getByTestId('library-card').first().innerText();
    await page.getByTestId('filter-all').click();
    assert(photos + videos === all && videos === videoCount, `all ${all} photos ${photos} videos ${videos} expected videos ${videoCount}`);
    return `전체 ${all} = 사진 ${photos} + 동영상 ${videos}; 카드: ${sample.replace(/\n/g, ' / ')}`;
  });

  await test('라이브러리: 다중 선택 → ZIP 일괄 다운로드', async () => {
    await page.getByTestId('library-card').nth(0).locator('input[type=checkbox]').check();
    await page.getByTestId('library-card').nth(1).locator('input[type=checkbox]').check();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('bulk-zip').click()]);
    const p = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(p);
    const b = fs.readFileSync(p);
    assert(b.subarray(0, 4).toString('hex') === '504b0304', 'zip sig');
    await page.getByTestId('library-card').nth(0).locator('input[type=checkbox]').uncheck();
    await page.getByTestId('library-card').nth(1).locator('input[type=checkbox]').uncheck();
    return `${dl.suggestedFilename()} (${b.length} bytes)`;
  });

  await test('라이브러리: 이름 변경', async () => {
    await page.getByTestId('library-card').first().locator('.card__thumb').click();
    await page.getByRole('button', { name: '이름 변경' }).click();
    await page.getByTestId('rename-input').fill('내 테스트 파일');
    await page.getByTestId('rename-ok').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="media-viewer"] h2').textContent.startsWith('내 테스트 파일.'));
    const title = await page.getByTestId('media-viewer').locator('h2').innerText();
    return title;
  });

  await test('로컬 영구 저장(IndexedDB) 후 새로고침해도 유지, 임시 파일은 구분', async () => {
    await page.getByTestId('viewer-persist').click();
    await page.waitForFunction(() => document.querySelector('.viewer__info').textContent.includes('IndexedDB'));
    await closeModals();
    const badges = await page.locator('.card__badges').allInnerTexts();
    const saved = badges.filter((b) => b.includes('로컬 저장')).length;
    const temp = badges.filter((b) => b.includes('임시')).length;
    await page.reload();
    await page.getByTestId('nav-library').click();
    await page.getByTestId('library-card').first().waitFor();
    const after = await page.getByTestId('library-card').count();
    const name = await page.getByTestId('library-card').first().locator('.card__name').innerText();
    assert(saved === 1 && after === 1, `saved ${saved} after reload ${after}`);
    assert(name.startsWith('내 테스트 파일'), name);
    assert(sawBeforeUnload, '임시 파일이 있을 때 페이지 이탈 경고가 표시되어야 함');
    return `저장 1 / 임시 ${temp} → 새로고침 후 ${after}개(${name}) · 이탈 경고 표시됨`;
  });

  await test('파일 삭제 전 확인 후 삭제(로컬 저장소 포함)', async () => {
    await page.getByTestId('select-all').check();
    await page.getByTestId('bulk-delete').click();
    await page.getByTestId('confirm-dialog').waitFor();
    await page.getByTestId('confirm-ok').click();
    await page.locator('.empty').waitFor();
    await page.reload();
    await page.getByTestId('nav-library').click();
    await page.locator('.empty').waitFor();
    return '삭제 후 새로고침해도 비어 있음';
  });

  await test('카메라·마이크 사용 종료 시 모든 트랙·오디오 분석기 정리', async () => {
    await page.getByTestId('nav-video').click();
    await page.getByTestId('start-devices').click();
    await page.getByTestId('actual-resolution').waitFor();
    await sleep(1000);
    await page.getByRole('button', { name: '카메라·마이크 사용 종료' }).first().click();
    await page.getByTestId('start-devices').waitFor();
    await sleep(300);
    const st = await page.evaluate(() => ({
      tracks: window.__gum.length,
      live: window.__gum.filter((t) => t.readyState === 'live').length,
      clonesLive: window.__clones.filter((t) => t.readyState === 'live').length,
      ctxOpen: window.__ctx.filter((c) => c.state !== 'closed').length,
      src: document.querySelector('[data-testid="preview-video"]').srcObject,
    }));
    const cam = await page.getByTestId('cam-indicator').innerText();
    assert(st.live === 0 && st.clonesLive === 0 && st.ctxOpen === 0 && st.src === null, JSON.stringify(st));
    assert(cam.includes('꺼짐'), cam);
    return `트랙 ${st.tracks}개 모두 종료, 분석 복제 트랙 0, 열린 AudioContext 0`;
  });

  await test('데스크톱 레이아웃 스크린샷', async () => {
    await page.getByTestId('start-devices').click();
    await page.getByTestId('actual-resolution').waitFor();
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, 'desktop-video.png') });
    await page.keyboard.press('p');
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'desktop-photo.png') });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `horizontal overflow ${overflow}`);
    return 'desktop-video.png, desktop-photo.png';
  });

  await test('모바일 레이아웃(390×844): 하단 탭, 가로 스크롤 없음, 미터 표시', async () => {
    const m = await A.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    // 실패 시 원인 파악용: 사라지기 전에 모든 알림을 기록한다.
    await m.addInitScript(() => {
      window.__toastLog = [];
      new MutationObserver(() => {
        document.querySelectorAll('[data-testid="toast"]').forEach((t) => {
          if (!window.__toastLog.includes(t.textContent)) window.__toastLog.push(t.textContent);
        });
      }).observe(document, { childList: true, subtree: true });
    });
    const mp = await m.newPage();
    await mp.goto(base);
    await mp.getByTestId('start-devices').click();
    await mp.getByTestId('actual-resolution').waitFor();
    await sleep(1500);
    const st = await mp.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      navPos: getComputedStyle(document.querySelector('.nav')).position,
      meter: !!document.querySelector('.center .meter'),
      frameW: document.querySelector('[data-testid="preview-frame"]').getBoundingClientRect().width,
    }));
    await mp.screenshot({ path: path.join(OUT, 'mobile-video.png'), fullPage: true });
    await mp.getByTestId('record-start').click();
    await mp.getByTestId('rec-indicator').waitFor();
    await sleep(1000);
    await mp.getByTestId('record-stop').click();
    try {
      await mp.getByTestId('review-card').waitFor({ timeout: 10000 });
    } catch (e) {
      await mp.screenshot({ path: path.join(OUT, 'mobile-failure.png'), fullPage: true });
      const diag = await mp.evaluate(() => ({
        ctrl: document.querySelector('.ctrl')?.innerText.replace(/\n/g, ' | '),
        toasts: window.__toastLog,
        thumbs: document.querySelector('.thumbs')?.innerText.replace(/\n/g, ' '),
      }));
      throw new Error(`${e.message.split('\n')[0]} — ${JSON.stringify(diag)}`);
    }
    await m.close();
    assert(st.overflow <= 0 && st.navPos === 'fixed' && st.meter && st.frameW > 300, JSON.stringify(st));
    return `nav=${st.navPos}, 미리보기 폭 ${Math.round(st.frameW)}px, 미터 표시, 모바일 녹화 OK`;
  });

  const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
  const phone = (ua, extra = {}) =>
    A.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: ua, ...extra });

  await test('모바일: 카카오톡 인앱 브라우저 감지 → 외부 브라우저 열기 안내', async () => {
    const m = await phone(`${ANDROID_UA} KAKAOTALK 10.8.0`);
    const mp = await m.newPage();
    await mp.goto(base);
    await mp.getByTestId('env-notice').waitFor();
    const text = await mp.getByTestId('env-notice').innerText();
    const href = await mp.getByTestId('open-external').getAttribute('href');
    await m.close();
    assert(text.includes('카카오톡') && href.startsWith('kakaotalk://web/openExternal?url='), `${text} ${href}`);
    const ok = await phone(IPHONE_UA);
    const op = await ok.newPage();
    await op.goto(base);
    await sleep(300);
    const none = await op.getByTestId('env-notice').count();
    await ok.close();
    assert(none === 0, '일반 Safari UA 에서는 안내가 없어야 함');
    return `안내 표시, 버튼 → ${href.slice(0, 40)}…; 일반 iPhone Safari UA 에서는 미표시`;
  });

  await test('모바일(아이폰 UA): 녹화 → 공유 시트로 사진 앱 저장', async () => {
    const m = await phone(IPHONE_UA);
    await m.addInitScript(() => {
      window.__shared = null;
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = async (d) => {
        window.__shared = d.files.map((f) => [f.name, f.type, f.size]);
      };
    });
    const mp = await m.newPage();
    await mp.goto(base);
    await mp.getByTestId('start-devices').click();
    await mp.getByTestId('actual-resolution').waitFor();
    await sleep(800);
    await mp.getByTestId('record-start').click();
    await mp.getByTestId('rec-indicator').waitFor();
    await sleep(1500);
    await mp.getByTestId('record-stop').click();
    await mp.getByTestId('review-card').waitFor({ timeout: 15000 });
    await mp.getByTestId('review-card').getByTestId('share-button').click();
    await mp.waitForFunction(() => window.__shared !== null);
    const shared = await mp.evaluate(() => window.__shared);
    await m.close();
    assert(shared.length === 1 && shared[0][2] > 1000 && shared[0][1].startsWith('video/'), JSON.stringify(shared));
    return `공유 파일 ${shared[0][0]} (${shared[0][1]}, ${shared[0][2]} bytes)`;
  });

  await test('모바일: 지원 형식을 하나도 보고하지 않는 브라우저에서도 기본 형식으로 녹화', async () => {
    const m = await phone(ANDROID_UA);
    await m.addInitScript(() => {
      MediaRecorder.isTypeSupported = () => false;
    });
    const mp = await m.newPage();
    await mp.goto(base);
    await mp.getByTestId('start-devices').click();
    await mp.getByTestId('actual-resolution').waitFor();
    const label = await mp.locator('.ctrl__fmt').innerText();
    await mp.getByTestId('record-start').click();
    await mp.getByTestId('rec-indicator').waitFor();
    await sleep(1500);
    await mp.getByTestId('record-stop').click();
    await mp.getByTestId('review-card').waitFor({ timeout: 15000 });
    await mp.getByTestId('review-card').getByRole('button', { name: '재생', exact: true }).click();
    const src = await mp.getByTestId('viewer-video').getAttribute('src');
    const r = await mp.evaluate(ANALYZE_VIDEO, src);
    const name = await mp.getByTestId('media-viewer').locator('h2').innerText();
    await m.close();
    assert(label.includes('브라우저 기본'), label);
    assert(r.size > 1000 && r.playedTo > 0 && !r.audio.error, JSON.stringify(r));
    return `"${label}" → ${name}, ${r.size} bytes, 재생·오디오 확인`;
  });

  await test('모바일: 앱 전환으로 끊긴 카메라를 화면 복귀 시 자동 재연결', async () => {
    const m = await phone(IPHONE_UA);
    const mp = await m.newPage();
    await mp.goto(base);
    await mp.getByTestId('start-devices').click();
    await mp.getByTestId('actual-resolution').waitFor();
    // iOS 가 백그라운드에서 트랙을 끝내는 상황: 실제로 트랙을 멈추고 ended 이벤트를 보낸다.
    await mp.getByTestId('preview-video').evaluate((v) => {
      const t = v.srcObject.getVideoTracks()[0];
      t.stop();
      t.dispatchEvent(new Event('ended'));
    });
    await mp.getByTestId('camera-error').waitFor();
    await mp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await mp.getByTestId('actual-resolution').waitFor({ timeout: 10000 });
    const live = await mp.getByTestId('preview-video').evaluate((v) => v.srcObject.getVideoTracks()[0].readyState);
    await m.close();
    assert(live === 'live', live);
    return '연결 끊김 표시 → 화면 복귀 시 버튼 없이 재연결';
  });

  await test('콘솔 오류 없음', async () => {
    const errs = consoleErrors.filter((e) => !e.includes('favicon'));
    assert(errs.length === 0, errs.join(' | '));
  });
  await A.close();

  // ================= 브라우저 B: 무음 입력 =================
  const B = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${silentWav}`]);
  const pb = await (await B.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await pb.goto(base);
  await test('오디오 입력이 없으면 무신호 상태 표시', async () => {
    await pb.getByTestId('start-devices').click();
    await pb.getByTestId('actual-resolution').waitFor();
    await sleep(2500);
    const zone = await pb.getByTestId('meter-zone').getAttribute('data-zone');
    const txt = await pb.getByTestId('meter-zone').innerText();
    const rms = await pb.getByTestId('meter-rms-L').innerText();
    assert(zone === 'silent' && txt.includes('무신호'), `${zone} ${txt}`);
    assert(rms.trim() === '-∞', `rms ${rms}`);
    return `"${txt}", RMS ${rms}`;
  });
  await B.close();

  // ================= 브라우저 C: 권한 거부 =================
  const C = await launch(['--use-fake-device-for-media-stream', '--deny-permission-prompts']);
  const pc = await (await C.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await pc.goto(base);
  await test('권한 거부 시 원인과 해결 방법 안내', async () => {
    await pc.getByTestId('start-devices').click();
    await pc.getByTestId('camera-error').waitFor({ timeout: 10000 });
    const t = await pc.getByTestId('camera-error').innerText();
    assert(t.includes('권한이 거부') && t.includes('허용'), t);
    const micNote = await pc.locator('.side--right .note--error').first().innerText();
    await pc.screenshot({ path: path.join(OUT, 'permission-denied.png') });
    assert(micNote.includes('마이크 권한'), micNote);
    return t.split('\n').slice(0, 2).join(' / ');
  });
  await C.close();

  await server.httpServer.close();

  // ---------- 보고서 ----------
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    `# Hiddenent Studio E2E 결과`,
    ``,
    `- 실행: ${new Date().toISOString()}`,
    `- 브라우저: Chromium (${EXE ?? 'default'}), 가짜 미디어 장치`,
    `- 결과: **${passed}/${results.length} 통과**`,
    ``,
    `| # | 항목 | 결과 | 시간 | 세부 |`,
    `|---|---|---|---|---|`,
    ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? '✅' : '❌'} | ${(r.ms / 1000).toFixed(1)}s | ${r.detail.replace(/\|/g, '\\|')} |`),
  ];
  fs.writeFileSync(path.join(OUT, 'e2e-report.md'), lines.join('\n') + '\n');
  console.log(`\n${passed}/${results.length} 통과 — 보고서: test-results/e2e-report.md`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
