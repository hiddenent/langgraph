// 실시간 L/R 오디오 레벨 미터(dBFS). 화면 갱신은 requestAnimationFrame + DOM ref 로 처리해
// React 재렌더 없이 60fps 로 움직이고, 상태 표시(무신호·클리핑 등)만 state 로 갱신한다.

import { useEffect, useRef, useState } from 'react';
import {
  LevelZone,
  METER_MIN_DB,
  MeterBallistics,
  NO_SIGNAL_DB,
  ZONE_LABEL,
  classifyLevel,
  dbToMeterFraction,
  formatDbfs,
  toDbfs,
} from '../core/audioLevel';
import type { AudioMeterHandle } from '../hooks/useAudioMeter';
import type { DeviceStatus } from '../hooks/useMediaSession';
import { Icon } from './Icon';

const TICKS = [-60, -40, -24, -12, -6, 0];

interface Props {
  handle: AudioMeterHandle;
  micStatus: DeviceStatus;
  micLabel: string;
  muted: boolean;
  monitoring: boolean;
  peakHoldMs: number;
  channelCount?: number;
  trackSampleRate?: number;
  onToggleMonitoring(): void;
  onToggleMute(): void;
  compact?: boolean;
}

interface MeterStatus {
  zone: LevelZone;
  clip: boolean;
  mono: boolean;
  noSignal: boolean;
  suspended: boolean;
}

const INITIAL: MeterStatus = { zone: 'silent', clip: false, mono: false, noSignal: true, suspended: false };

export function AudioMeter(p: Props) {
  const { handle, monitoring, peakHoldMs } = p;
  const ballistics = useRef([new MeterBallistics(24, peakHoldMs), new MeterBallistics(24, peakHoldMs)]);
  const rmsSmooth = useRef([-Infinity, -Infinity]);
  const coverRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const holdRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const rmsTextRefs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const peakTextRefs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const maxTextRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<MeterStatus>(INITIAL);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    ballistics.current.forEach((b) => (b.holdMs = peakHoldMs));
  }, [peakHoldMs]);

  const active = monitoring && (handle.state === 'running' || handle.state === 'suspended');

  useEffect(() => {
    if (!active) {
      coverRefs.forEach((r) => r.current && (r.current.style.transform = 'scaleX(1)'));
      holdRefs.forEach((r) => r.current && (r.current.style.opacity = '0'));
      rmsTextRefs.forEach((r) => r.current && (r.current.textContent = '-∞'));
      peakTextRefs.forEach((r) => r.current && (r.current.textContent = '-∞'));
      setStatus(INITIAL);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let lastText = 0;
    let silentSince = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      let reading = null;
      try {
        reading = handle.engine.read();
      } catch {
        reading = null;
      }
      const suspended = handle.engine.contextState === 'suspended';
      if (!reading) {
        if (suspended !== statusRef.current.suspended) setStatus((s) => ({ ...s, suspended }));
        return;
      }
      const chans = [reading.left, reading.right];
      let loudestPeak = -Infinity;
      let anyClip = false;
      chans.forEach((c, i) => {
        const peakDb = toDbfs(c.peak);
        const rmsDb = toDbfs(c.rms);
        const b = ballistics.current[i];
        b.update(peakDb, peakDb, c.clipped, now, dt);
        // RMS 표시값은 약 300ms 시정수로 평활화(dB 영역)
        const prev = rmsSmooth.current[i];
        const target = Number.isFinite(rmsDb) ? rmsDb : -120;
        const base = Number.isFinite(prev) ? prev : target;
        const sm = base + (target - base) * Math.min(1, dt / 300);
        rmsSmooth.current[i] = sm < -119 ? -Infinity : sm;
        const frac = dbToMeterFraction(b.level);
        const cover = coverRefs[i].current;
        if (cover) cover.style.transform = `scaleX(${(1 - frac).toFixed(4)})`;
        const hold = holdRefs[i].current;
        if (hold) {
          const hf = dbToMeterFraction(b.peakHold);
          hold.style.opacity = hf > 0 ? '1' : '0';
          hold.style.left = `calc(${(hf * 100).toFixed(2)}% - 1px)`;
        }
        if (peakDb > loudestPeak) loudestPeak = peakDb;
        if (b.clipLatched) anyClip = true;
      });
      if (now - lastText > 100) {
        lastText = now;
        chans.forEach((_, i) => {
          const r = rmsTextRefs[i].current;
          if (r) r.textContent = formatDbfs(rmsSmooth.current[i]);
          const pk = peakTextRefs[i].current;
          if (pk) pk.textContent = formatDbfs(ballistics.current[i].peakHold);
        });
        const maxPk = Math.max(ballistics.current[0].maxPeak, ballistics.current[1].maxPeak);
        if (maxTextRef.current) maxTextRef.current.textContent = formatDbfs(maxPk);
        const loudLevel = Math.max(ballistics.current[0].level, ballistics.current[1].level);
        if (loudLevel >= NO_SIGNAL_DB) silentSince = now;
        const noSignal = now - silentSince > 1200;
        const zone = noSignal ? 'silent' : classifyLevel(loudLevel);
        const cur = statusRef.current;
        if (
          cur.zone !== zone ||
          cur.clip !== anyClip ||
          cur.mono !== reading.mono ||
          cur.noSignal !== noSignal ||
          cur.suspended !== suspended
        ) {
          setStatus({ zone, clip: anyClip, mono: reading.mono, noSignal, suspended });
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // ref 배열은 렌더마다 새로 만들어지지만 내부 ref 객체는 안정적이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, handle.engine]);

  const resetPeak = () => {
    ballistics.current.forEach((b) => b.resetPeak());
    if (maxTextRef.current) maxTextRef.current.textContent = '-∞';
    setStatus((s) => ({ ...s, clip: false }));
  };

  let banner: { kind: string; icon: string; text: string } | null = null;
  if (p.micStatus === 'off') banner = { kind: 'idle', icon: 'micOff', text: '마이크가 연결되지 않았습니다' };
  else if (p.micStatus === 'starting') banner = { kind: 'idle', icon: 'mic', text: '마이크 연결 중…' };
  else if (p.micStatus === 'error' || p.micStatus === 'disconnected')
    banner = { kind: 'error', icon: 'alert', text: '마이크 오류 — 장치 설정을 확인하세요' };
  else if (!monitoring) banner = { kind: 'idle', icon: 'eye', text: '오디오 모니터링 꺼짐 (녹음에는 영향 없음)' };
  else if (handle.state === 'error') banner = { kind: 'error', icon: 'alert', text: `오디오 분석 실패: ${handle.error ?? ''} (녹화는 계속 가능)` };
  else if (status.suspended) banner = { kind: 'warn', icon: 'info', text: '브라우저가 오디오 분석을 일시 중지했습니다' };

  const zoneShown: LevelZone = status.clip ? 'clip' : status.zone;
  const sr = p.trackSampleRate ?? handle.sampleRate;

  return (
    <section className={`meter ${p.compact ? 'meter--compact' : ''}`} aria-label="오디오 레벨 미터">
      <header className="meter__head">
        <div className="meter__title">
          <Icon name={p.muted ? 'micOff' : 'mic'} size={16} />
          <span className="meter__label" title={p.micLabel}>
            {p.micLabel || '마이크'}
          </span>
          {p.muted && <span className="badge badge--warn">음소거 — 녹음 안 됨</span>}
        </div>
        <div className="meter__actions">
          <button type="button" className="btn btn--ghost btn--xs" onClick={p.onToggleMute} aria-pressed={p.muted} title="마이크 음소거 전환 (M)">
            {p.muted ? '음소거 해제' : '음소거'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={p.onToggleMonitoring}
            aria-pressed={monitoring}
            title="시각적 오디오 모니터링 켜기/끄기(스피커로 소리를 내보내지 않습니다)"
          >
            모니터링 {monitoring ? '끄기' : '켜기'}
          </button>
          <button type="button" className="btn btn--ghost btn--xs" onClick={resetPeak} title="피크 및 클리핑 표시 초기화" data-testid="meter-reset">
            피크 초기화
          </button>
        </div>
      </header>

      <div className="meter__body">
        {(['L', 'R'] as const).map((ch, i) => (
          <div className="meter__row" key={ch}>
            <span className="meter__ch" aria-hidden="true">
              {ch}
            </span>
            <div className="meter__bar" role="presentation">
              <div className="meter__fill" />
              <div className="meter__cover" ref={coverRefs[i]} />
              <div className="meter__hold" ref={holdRefs[i]} />
            </div>
            <span className="meter__num" aria-label={`${ch} 채널 RMS dBFS`}>
              <span ref={rmsTextRefs[i]} data-testid={`meter-rms-${ch}`}>
                -∞
              </span>
            </span>
            <span className="meter__num meter__num--peak" aria-label={`${ch} 채널 피크 dBFS`}>
              <span ref={peakTextRefs[i]} data-testid={`meter-peak-${ch}`}>
                -∞
              </span>
            </span>
          </div>
        ))}
        <div className="meter__scale" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} style={{ left: `${dbToMeterFraction(t, METER_MIN_DB) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        {banner && (
          <div className={`meter__banner meter__banner--${banner.kind}`} role="status">
            <Icon name={banner.icon} size={16} />
            <span>{banner.text}</span>
            {status.suspended && (
              <button type="button" className="btn btn--xs" onClick={() => void handle.resume()}>
                미터 시작
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="meter__foot">
        <span className={`zone zone--${zoneShown}`} data-testid="meter-zone" data-zone={zoneShown} role="status" aria-live="polite">
          <span className="zone__dot" aria-hidden="true" />
          {status.noSignal && monitoring && p.micStatus === 'live' ? '무신호 (입력 없음)' : ZONE_LABEL[zoneShown]}
          {status.clip && ' · 클리핑 발생'}
        </span>
        <span className="meter__meta">
          최대 피크 <b ref={maxTextRef} data-testid="meter-max">-∞</b> dBFS
        </span>
        <span className="meter__meta">{status.mono ? '모노 입력(L/R 동일 표시)' : '스테레오/2채널'}</span>
        <span className="meter__meta">
          {sr ? `${(sr / 1000).toFixed(1)} kHz` : '샘플레이트 확인 불가'}
          {p.channelCount ? ` · ${p.channelCount}ch` : ''}
        </span>
        <span className="meter__meta meter__hint" title="dBFS 는 디지털 풀스케일(0 dBFS) 대비 상대 레벨이며 실제 음압(dB SPL)이나 하드웨어 입력 게인을 뜻하지 않습니다.">
          dBFS = 디지털 상대 레벨
        </span>
      </footer>
    </section>
  );
}
