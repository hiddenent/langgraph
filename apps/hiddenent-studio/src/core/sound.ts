// 카운트다운·셔터 효과음. 짧은 합성음만 재생하며 마이크 입력은 절대 스피커로 출력하지 않는다.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durationMs: number, gainValue = 0.08, type: OscillatorType = 'sine'): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = c.currentTime;
  gain.gain.setValueAtTime(gainValue, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + durationMs / 1000 + 0.02);
}

export function countdownBeep(final = false): void {
  tone(final ? 1320 : 880, final ? 260 : 120);
}

export function shutterSound(): void {
  const c = getCtx();
  if (!c) return;
  // 짧은 노이즈 버스트로 셔터음을 흉내 낸다.
  const len = Math.floor(c.sampleRate * 0.06);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  const gain = c.createGain();
  gain.gain.value = 0.25;
  src.buffer = buf;
  src.connect(gain).connect(c.destination);
  src.start();
}

export function recordStartSound(): void {
  tone(660, 90);
  setTimeout(() => tone(990, 140), 110);
}

export function disposeSound(): void {
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  ctx = null;
}
