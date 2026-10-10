import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioMeterEngine, MeterEngineState } from '../core/audioMeterEngine';

export interface AudioMeterHandle {
  engine: AudioMeterEngine;
  state: MeterEngineState;
  error: string | null;
  sampleRate: number | null;
  resume(): Promise<void>;
}

/**
 * 마이크 트랙이 바뀌면 분석 그래프를 즉시 재구성한다.
 * 분석 실패는 여기서만 처리하며 녹화 기능에는 영향을 주지 않는다.
 */
export function useAudioMeter(track: MediaStreamTrack | null, enabled: boolean): AudioMeterHandle {
  const engineRef = useRef<AudioMeterEngine>(new AudioMeterEngine());
  const [state, setState] = useState<MeterEngineState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  useEffect(() => {
    const engine = engineRef.current;
    if (!track || !enabled || track.readyState === 'ended') {
      engine.stop();
      setState('idle');
      setSampleRate(null);
      return;
    }
    let cancelled = false;
    engine
      .start(track)
      .then(() => {
        if (cancelled) return;
        setState(engine.state);
        setError(null);
        setSampleRate(engine.sampleRate);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState('error');
        setError(e instanceof Error ? e.message : '오디오 분석을 시작할 수 없습니다.');
      });
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, [track, enabled]);

  const resume = useCallback(async () => {
    try {
      await engineRef.current.resume();
      setState(engineRef.current.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오디오 분석을 재개할 수 없습니다.');
    }
  }, []);

  // 자동재생 정책으로 AudioContext 가 멈춰 있으면 다음 사용자 입력에서 재개한다.
  useEffect(() => {
    if (state !== 'suspended') return;
    const onGesture = () => void resume();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [state, resume]);

  return { engine: engineRef.current, state, error, sampleRate, resume };
}
