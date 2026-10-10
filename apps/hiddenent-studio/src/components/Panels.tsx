// 촬영 설정 패널: 장치, 동영상, 오디오, 사진, 하드웨어 제어.

import { useId } from 'react';
import { EFFECT_LABELS, ColorEffect } from '../core/colorMatrix';
import { ASPECTS, AspectId, FRAME_RATES, RESOLUTIONS } from '../core/devices';
import { formatBitrate } from '../core/format';
import { imageCaptureSupported } from '../core/photo';
import type { VideoQuality } from '../core/settings';
import { useStudio } from '../StudioContext';
import { Icon } from './Icon';
import { Field, Panel, Range, Segmented, Select, StatusPill, Toggle } from './ui';

type Caps = Record<string, unknown>;

function rangeCap(caps: Caps, key: string): { min: number; max: number; step?: number } | null {
  const v = caps[key] as { min?: number; max?: number; step?: number } | undefined;
  if (v && typeof v.min === 'number' && typeof v.max === 'number' && v.max > v.min) {
    return { min: v.min, max: v.max, step: v.step };
  }
  return null;
}

function listCap(caps: Caps, key: string): string[] | null {
  const v = caps[key];
  return Array.isArray(v) && v.length > 0 ? (v as string[]) : null;
}

const LockNote = () => (
  <p className="note note--warn" role="status">
    <Icon name="info" size={14} /> 녹화·촬영 중에는 장치와 촬영 설정을 바꿀 수 없습니다(파일 손상 방지).
  </p>
);

export function DevicePanel() {
  const { settings, update, session, locked, switchCamera } = useStudio();
  const { devices, camera, mic } = session;
  const camValue = settings.cameraId || (camera.settings?.deviceId as string | undefined) || '';
  const micValue = settings.micId || (mic.settings?.deviceId as string | undefined) || '';
  const camOptions = devices.cameras.map((d) => ({ value: d.deviceId, label: d.label }));
  const micOptions = devices.microphones.map((d) => ({ value: d.deviceId, label: d.label }));
  if (!camOptions.some((o) => o.value === camValue)) camOptions.unshift({ value: camValue, label: camValue ? '현재 카메라' : '기본 카메라' });
  if (!micOptions.some((o) => o.value === micValue)) micOptions.unshift({ value: micValue, label: micValue ? '현재 마이크' : '기본 마이크' });
  const facing = camera.settings?.facingMode;

  return (
    <Panel title="장치 선택" icon="camera">
      {locked && <LockNote />}
      <Select
        label={`카메라 (${devices.cameras.length}개 감지)`}
        value={camValue}
        options={camOptions}
        disabled={locked || devices.cameras.length === 0}
        onChange={(v) => update((s) => ({ ...s, cameraId: v, facing: null }))}
        testId="camera-select"
        hint={
          <>
            상태: <DeviceState status={camera.status} />
            {facing && <> · {facing === 'user' ? '전면' : facing === 'environment' ? '후면' : facing} 카메라</>}
          </>
        }
      />
      <button
        type="button"
        className="btn btn--block"
        onClick={switchCamera}
        disabled={locked || camera.status === 'starting' || devices.cameras.length < 1}
        title="전면/후면 카메라 또는 다음 카메라로 전환"
        data-testid="switch-camera"
      >
        <Icon name="switchCam" /> 전면/후면(다음 카메라) 전환
      </button>
      <Select
        label={`마이크 (${devices.microphones.length}개 감지)`}
        value={micValue}
        options={micOptions}
        disabled={locked || devices.microphones.length === 0}
        onChange={(v) => update((s) => ({ ...s, micId: v }))}
        testId="mic-select"
        hint={
          <>
            상태: <DeviceState status={mic.status} />
            {mic.error && ` — ${mic.error.title}`}
          </>
        }
      />
      {mic.notice && <p className="note">{mic.notice}</p>}
      {mic.error && mic.status !== 'live' && (
        <div className="note note--error" role="alert">
          <b>{mic.error.title}</b>
          <p>{mic.error.detail}</p>
          {mic.error.retryable && (
            <button type="button" className="btn btn--xs" onClick={session.retryMic}>
              마이크 다시 시도
            </button>
          )}
        </div>
      )}
      {!session.labelsAvailable && (
        <p className="note">
          <Icon name="info" size={14} /> 장치 이름은 권한을 허용한 뒤에 표시됩니다. 브라우저가 노출하는 장치만 나열하며, 실제
          물리 장치와의 연결 관계는 운영체제 설정을 따릅니다.
        </p>
      )}
      <button type="button" className="btn btn--ghost btn--block" onClick={() => void session.refreshDevices()} data-testid="rescan">
        <Icon name="refresh" /> 장치 다시 찾기
      </button>
    </Panel>
  );
}

export function DeviceState({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    off: ['꺼짐', 'muted'],
    starting: ['연결 중', 'warn'],
    live: ['사용 중', 'ok'],
    error: ['오류', 'err'],
    disconnected: ['연결 끊김', 'err'],
  };
  const [label, cls] = map[status] ?? ['알 수 없음', 'muted'];
  return <span className={`state state--${cls}`}>{label}</span>;
}

const QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: 'auto', label: '자동(브라우저 기본)' },
  { value: 'low', label: '낮음(작은 파일)' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' },
  { value: 'max', label: '최고' },
  { value: 'custom', label: '직접 입력' },
];

const LIMIT_OPTIONS = [
  { value: 0, label: '제한 없음' },
  { value: 15, label: '15초' },
  { value: 30, label: '30초' },
  { value: 60, label: '1분' },
  { value: 300, label: '5분' },
  { value: 600, label: '10분' },
  { value: 1800, label: '30분' },
  { value: 3600, label: '60분' },
];

function useResolutionOptions() {
  const { session } = useStudio();
  const caps = session.camera.capabilities as Caps;
  const w = rangeCap(caps, 'width');
  const h = rangeCap(caps, 'height');
  const maxLong = w && h ? Math.max(w.max, h.max) : null;
  const maxShort = w && h ? Math.min(w.max, h.max) : null;
  return RESOLUTIONS.map((r) => {
    const unsupported = maxLong !== null && maxShort !== null && (r.width > maxLong || r.height > maxShort);
    return { value: r.id, label: `${r.label}${unsupported ? ' — 장치 미지원' : ''}`, disabled: unsupported };
  });
}

export function VideoSettingsPanel() {
  const { settings, patch, session, recorder, locked } = useStudio();
  const v = settings.video;
  const caps = session.camera.capabilities as Caps;
  const fpsCap = rangeCap(caps, 'frameRate');
  const resOptions = useResolutionOptions();
  const fpsOptions = FRAME_RATES.map((f) => {
    const unsupported = fpsCap !== null && f > fpsCap.max + 0.5;
    return { value: f, label: `${f} fps${unsupported ? ' — 장치 미지원' : ''}`, disabled: unsupported };
  });
  const s = session.camera.settings;
  const req = RESOLUTIONS.find((r) => r.id === v.resolutionId);
  const actualShort = s?.width && s?.height ? Math.min(s.width, s.height) : null;
  const resMismatch = req && actualShort !== null && Math.abs(actualShort - req.height) > 8;
  const fpsMismatch = s?.frameRate && Math.abs(s.frameRate - v.frameRate) > 1;
  const formatOptions = [
    { value: 'auto', label: `자동 (${recorder.formats[0]?.label ?? '지원 형식 없음'})` },
    ...recorder.formats.map((f) => ({ value: f.mimeType, label: f.label })),
  ];
  const tplId = useId();

  return (
    <Panel title="동영상 설정" icon="video">
      {locked && <LockNote />}
      <Select label="해상도" value={v.resolutionId} options={resOptions} disabled={locked} onChange={(x) => patch('video', { resolutionId: x })} testId="video-resolution" />
      <Select label="프레임 레이트" value={v.frameRate} options={fpsOptions} disabled={locked} onChange={(x) => patch('video', { frameRate: x })} testId="video-fps" />
      {s && (
        <p className={`note ${resMismatch || fpsMismatch ? 'note--warn' : ''}`} data-testid="applied-video">
          실제 적용: <b>{s.width}×{s.height}</b>
          {s.frameRate ? <> · <b>{Math.round(s.frameRate * 10) / 10} fps</b></> : ' · fps 확인 불가'}
          {(resMismatch || fpsMismatch) && ' — 장치가 요청한 값을 지원하지 않아 가장 가까운 값이 적용되었습니다.'}
        </p>
      )}
      <Segmented<AspectId>
        label="화면 비율"
        value={v.aspect}
        options={ASPECTS.map((a) => ({ value: a.id, label: a.id }))}
        disabled={locked}
        onChange={(x) => patch('video', { aspect: x })}
      />
      <p className="note" data-testid="record-plan">
        <Icon name="info" size={14} /> {recorder.plan.reason}
      </p>
      <Select label="영상 품질(비트레이트)" value={v.quality} options={QUALITY_OPTIONS} disabled={locked} onChange={(x) => patch('video', { quality: x })} hint="브라우저에 따라 비트레이트는 목표값으로만 사용됩니다. 녹화 후 실제 평균 비트레이트를 라이브러리에 표시합니다." />
      {v.quality === 'custom' && (
        <Range
          label="비디오 비트레이트"
          value={v.customBitrate}
          min={500_000}
          max={50_000_000}
          step={500_000}
          onChange={(x) => patch('video', { customBitrate: x })}
          format={formatBitrate}
          disabled={locked}
        />
      )}
      <Select
        label="녹화 형식(컨테이너·코덱)"
        value={v.format}
        options={formatOptions}
        disabled={locked || recorder.formats.length === 0}
        onChange={(x) => patch('video', { format: x })}
        testId="video-format"
        hint={recorder.formats.length === 0 ? '이 브라우저에서 사용 가능한 녹화 형식이 없습니다.' : `이 브라우저에서 확인된 지원 형식 ${recorder.formats.length}개만 표시합니다.`}
      />
      <Toggle label="오디오 포함 녹화" checked={v.includeAudio} disabled={locked} onChange={(x) => patch('video', { includeAudio: x })} testId="include-audio" />
      <Select label="녹화 시간 제한" value={v.timeLimitSec} options={LIMIT_OPTIONS} disabled={locked} onChange={(x) => patch('video', { timeLimitSec: x })} />
      <Segmented
        label="녹화 전 카운트다운"
        value={v.countdown}
        options={[0, 3, 5, 10].map((n) => ({ value: n, label: n ? `${n}초` : '없음' }))}
        disabled={locked}
        onChange={(x) => patch('video', { countdown: x })}
      />
      <Toggle label="미리보기 좌우 반전" checked={v.mirrorPreview} onChange={(x) => patch('video', { mirrorPreview: x })} hint="화면 표시만 반전합니다." />
      <Toggle label="녹화 파일도 좌우 반전" checked={v.mirrorFile} disabled={locked} onChange={(x) => patch('video', { mirrorFile: x })} hint="캔버스 처리 녹화로 전환됩니다." />
      <Field label="저장 파일명 템플릿" htmlFor={tplId} hint="{date} {time} {type} {seq} 사용 가능, 확장자는 형식에 맞게 자동 지정">
        <input id={tplId} className="input" value={v.fileTemplate} onChange={(e) => patch('video', { fileTemplate: e.target.value })} />
      </Field>
    </Panel>
  );
}

function constraintState(supported: boolean | undefined, requested: boolean, applied: unknown, capability: unknown) {
  if (!supported) return { ok: null as boolean | null, text: '브라우저 미지원' };
  if (Array.isArray(capability) && capability.length === 1 && capability[0] !== requested) {
    return { ok: false, text: '장치에서 변경 불가' };
  }
  if (typeof applied !== 'boolean') return { ok: null, text: '적용 상태 확인 불가' };
  if (applied === requested) return { ok: true, text: applied ? '켜짐(적용됨)' : '꺼짐(적용됨)' };
  return { ok: false, text: `요청과 다름: 실제 ${applied ? '켜짐' : '꺼짐'}` };
}

export function AudioSettingsPanel() {
  const { settings, patch, session, meter, locked } = useStudio();
  const a = settings.audio;
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  const ms = (session.mic.settings ?? {}) as MediaTrackSettings & { latency?: number };
  const caps = session.mic.capabilities as Caps;
  const rows: { key: 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'; label: string }[] = [
    { key: 'echoCancellation', label: '에코 제거' },
    { key: 'noiseSuppression', label: '노이즈 억제' },
    { key: 'autoGainControl', label: '자동 게인 제어(AGC)' },
  ];
  return (
    <Panel title="오디오 설정" icon="mic">
      {locked && <LockNote />}
      <Toggle label="마이크 음소거 (M)" checked={a.muted} onChange={(x) => patch('audio', { muted: x })} hint="음소거 중에도 미터는 입력을 표시하지만 녹음에는 무음이 기록됩니다." testId="mute-toggle" />
      <Toggle label="녹화에 오디오 포함" checked={settings.video.includeAudio} disabled={locked} onChange={(x) => patch('video', { includeAudio: x })} />
      <Select
        label="오디오 비트레이트"
        value={a.bitrate}
        disabled={locked}
        options={[64_000, 96_000, 128_000, 192_000, 256_000, 320_000].map((b) => ({ value: b, label: `${b / 1000} kbps` }))}
        onChange={(x) => patch('audio', { bitrate: x })}
      />
      <Segmented<1 | 2>
        label="채널 요청"
        value={a.channelCount}
        disabled={locked || !supported.channelCount}
        options={[
          { value: 1, label: '모노' },
          { value: 2, label: '스테레오' },
        ]}
        onChange={(x) => patch('audio', { channelCount: x })}
      />
      <dl className="kv">
        <dt>샘플 레이트</dt>
        <dd data-testid="audio-samplerate">
          {ms.sampleRate ? `${ms.sampleRate} Hz` : meter.sampleRate ? `${meter.sampleRate} Hz (분석 컨텍스트 기준)` : '확인 불가'}
        </dd>
        <dt>채널 수</dt>
        <dd data-testid="audio-channels">{ms.channelCount ? `${ms.channelCount}ch` : '확인 불가(브라우저 미제공)'}</dd>
        <dt>지연(latency)</dt>
        <dd>{typeof ms.latency === 'number' ? `${(ms.latency * 1000).toFixed(1)} ms` : '확인 불가'}</dd>
      </dl>
      <div className="subhead">입력 처리 (마이크 입력에 영향을 줍니다)</div>
      {rows.map((r) => {
        const st = constraintState(supported[r.key], a[r.key], ms[r.key], caps[r.key]);
        return (
          <div key={r.key} className="constraint-row">
            <Toggle
              label={r.label}
              checked={a[r.key]}
              disabled={locked || !supported[r.key]}
              onChange={(x) => patch('audio', { [r.key]: x } as Partial<typeof a>)}
            />
            <StatusPill ok={st.ok} label={st.text} testId={`constraint-${r.key}`} />
          </div>
        );
      })}
      <div className="subhead">모니터링</div>
      <Toggle label="오디오 레벨 모니터링" checked={a.monitoring} onChange={(x) => patch('audio', { monitoring: x })} hint="시각적 미터만 사용하며 스피커로 소리를 내보내지 않습니다(하울링 방지)." />
      <Select
        label="피크 홀드 시간"
        value={a.peakHoldMs}
        options={[
          { value: 1000, label: '1초' },
          { value: 1500, label: '1.5초' },
          { value: 3000, label: '3초' },
          { value: Number.POSITIVE_INFINITY, label: '초기화할 때까지 유지' },
        ].map((o) => ({ ...o, value: o.value === Number.POSITIVE_INFINITY ? 999999999 : o.value }))}
        onChange={(x) => patch('audio', { peakHoldMs: x })}
      />
    </Panel>
  );
}

export function PhotoSettingsPanel() {
  const { settings, patch, photo, locked } = useStudio();
  const p = settings.photo;
  const resOptions = useResolutionOptions();
  const color = p.color;
  const setColor = (c: Partial<typeof color>) => patch('photo', { color: { ...color, ...c } });
  const wmId = useId();
  const tplId = useId();
  const fmt = photo.imageFormats.find((f) => f.mime === p.format);
  return (
    <>
      <Panel title="사진 촬영 설정" icon="photo">
        {locked && <LockNote />}
        <Select label="카메라 해상도" value={p.resolutionId} options={resOptions} disabled={locked} onChange={(x) => patch('photo', { resolutionId: x })} />
        <Segmented<AspectId>
          label="화면 비율"
          value={p.aspect}
          options={ASPECTS.map((a) => ({ value: a.id, label: a.id }))}
          disabled={locked}
          onChange={(x) => patch('photo', { aspect: x })}
        />
        <Toggle
          label="원본 해상도 캡처(ImageCapture)"
          checked={p.useImageCapture && imageCaptureSupported()}
          disabled={locked || !imageCaptureSupported()}
          onChange={(x) => patch('photo', { useImageCapture: x })}
          hint={imageCaptureSupported() ? '카메라의 사진 모드 해상도로 촬영합니다(실패 시 미리보기 프레임 사용).' : '이 브라우저는 ImageCapture 를 지원하지 않아 미리보기 프레임으로 캡처합니다.'}
        />
        <Select
          label="저장 형식"
          value={p.format}
          options={photo.imageFormats.map((f) => ({ value: f.mime, label: f.label }))}
          onChange={(x) => patch('photo', { format: x })}
          testId="photo-format"
          hint="이 브라우저에서 실제로 생성 가능한 형식만 표시합니다."
        />
        {fmt?.lossy && (
          <Range label="품질" value={p.quality} min={0.5} max={1} step={0.01} onChange={(x) => patch('photo', { quality: x })} format={(x) => `${Math.round(x * 100)}%`} />
        )}
        <Select
          label="최대 크기(긴 변)"
          value={p.maxLongEdge}
          options={[
            { value: 0, label: '원본 유지' },
            { value: 3840, label: '3840 px' },
            { value: 1920, label: '1920 px' },
            { value: 1280, label: '1280 px' },
            { value: 640, label: '640 px' },
          ]}
          onChange={(x) => patch('photo', { maxLongEdge: x })}
        />
        <Segmented label="셀프 타이머" value={p.timer} options={[0, 3, 5, 10].map((n) => ({ value: n, label: n ? `${n}초` : '끔' }))} disabled={locked} onChange={(x) => patch('photo', { timer: x })} />
        <Segmented
          label="촬영 방식"
          value={p.drive}
          disabled={locked}
          options={[
            { value: 'single', label: '단일' },
            { value: 'burst', label: '버스트' },
            { value: 'interval', label: '연속(인터벌)' },
          ]}
          onChange={(x) => patch('photo', { drive: x })}
        />
        {p.drive === 'burst' && (
          <>
            <Range label="버스트 매수" value={p.burstCount} min={2} max={30} step={1} onChange={(x) => patch('photo', { burstCount: x })} format={(x) => `${x}장`} disabled={locked} />
            <Range label="버스트 간격" value={p.burstIntervalMs} min={100} max={2000} step={50} onChange={(x) => patch('photo', { burstIntervalMs: x })} format={(x) => `${x} ms`} disabled={locked} />
          </>
        )}
        {p.drive === 'interval' && (
          <>
            <Range label="촬영 간격" value={p.intervalSec} min={1} max={60} step={1} onChange={(x) => patch('photo', { intervalSec: x })} format={(x) => `${x}초`} disabled={locked} />
            <Range label="최대 매수" value={p.intervalMax} min={2} max={200} step={1} onChange={(x) => patch('photo', { intervalMax: x })} format={(x) => `${x}장`} disabled={locked} />
          </>
        )}
        <Toggle label="미리보기 좌우 반전(셀피)" checked={p.mirrorPreview} onChange={(x) => patch('photo', { mirrorPreview: x })} hint="화면 표시만 반전합니다." />
        <Toggle label="저장 이미지 좌우 반전" checked={p.mirrorFile} onChange={(x) => patch('photo', { mirrorFile: x })} hint="실제 파일 픽셀을 반전합니다(미리보기 반전과 별개)." />
        <Segmented
          label="이미지 회전 보정"
          value={p.rotation}
          options={([0, 90, 180, 270] as const).map((r) => ({ value: r, label: `${r}°` }))}
          onChange={(x) => patch('photo', { rotation: x })}
        />
        <Toggle label="셔터음" checked={p.shutterSound} onChange={(x) => patch('photo', { shutterSound: x })} />
        <Field label="파일명 템플릿" htmlFor={tplId} hint="{date} {time} {type} {seq}">
          <input id={tplId} className="input" value={p.fileTemplate} onChange={(e) => patch('photo', { fileTemplate: e.target.value })} />
        </Field>
      </Panel>
      <Panel title="미리보기 보정 · 효과 (소프트웨어 후처리)" icon="edit" defaultOpen={false}>
        <p className="note">카메라 하드웨어 설정이 아니라 브라우저에서 픽셀을 보정합니다. 미리보기와 저장 사진에 똑같이 적용됩니다.</p>
        <Range label="밝기" value={color.brightness} min={-100} max={100} step={1} onChange={(x) => setColor({ brightness: x })} />
        <Range label="대비" value={color.contrast} min={-100} max={100} step={1} onChange={(x) => setColor({ contrast: x })} />
        <Range label="채도" value={color.saturation} min={-100} max={100} step={1} onChange={(x) => setColor({ saturation: x })} />
        <Range label="색온도" value={color.temperature} min={-100} max={100} step={1} onChange={(x) => setColor({ temperature: x })} format={(x) => (x > 0 ? `따뜻하게 +${x}` : x < 0 ? `차갑게 ${x}` : '0')} />
        <Select<ColorEffect>
          label="색상 효과"
          value={color.effect}
          options={(Object.keys(EFFECT_LABELS) as ColorEffect[]).map((k) => ({ value: k, label: EFFECT_LABELS[k] }))}
          onChange={(x) => setColor({ effect: x })}
          testId="photo-effect"
        />
        <button type="button" className="btn btn--ghost btn--block" onClick={() => patch('photo', { color: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, effect: 'none' } })}>
          보정 초기화
        </button>
      </Panel>
      <Panel title="날짜 · 워터마크" icon="edit" defaultOpen={false}>
        <Toggle label="촬영 날짜·시간 표시" checked={p.timestamp} onChange={(x) => patch('photo', { timestamp: x })} />
        <Field label="워터마크 텍스트" htmlFor={wmId}>
          <input id={wmId} className="input" value={p.watermarkText} placeholder="예: © Hiddenent" maxLength={60} onChange={(e) => patch('photo', { watermarkText: e.target.value })} />
        </Field>
        <Select
          label="워터마크 위치"
          value={p.watermarkPosition}
          options={[
            { value: 'bottom-right', label: '오른쪽 아래' },
            { value: 'bottom-left', label: '왼쪽 아래' },
            { value: 'top-right', label: '오른쪽 위' },
            { value: 'top-left', label: '왼쪽 위' },
            { value: 'center', label: '가운데' },
          ]}
          onChange={(x) => patch('photo', { watermarkPosition: x })}
        />
        <Range label="워터마크 불투명도" value={p.watermarkOpacity} min={0.1} max={1} step={0.05} onChange={(x) => patch('photo', { watermarkOpacity: x })} format={(x) => `${Math.round(x * 100)}%`} />
      </Panel>
    </>
  );
}

export function GuidesPanel() {
  const { settings, patch } = useStudio();
  const g = settings.guides;
  return (
    <Panel title="촬영 보조" icon="grid" defaultOpen={false}>
      <Toggle label="구도 가이드 표시 (G)" checked={g.visible} onChange={(x) => patch('guides', { visible: x })} testId="guides-visible" />
      <div className="grid2">
        <Toggle label="삼분할" checked={g.thirds} onChange={(x) => patch('guides', { thirds: x })} disabled={!g.visible} />
        <Toggle label="황금비" checked={g.golden} onChange={(x) => patch('guides', { golden: x })} disabled={!g.visible} />
        <Toggle label="중앙 십자선" checked={g.crosshair} onChange={(x) => patch('guides', { crosshair: x })} disabled={!g.visible} />
        <Toggle label="안전 영역" checked={g.safe} onChange={(x) => patch('guides', { safe: x })} disabled={!g.visible} hint="액션 93% · 타이틀 90%" />
        <Toggle label="수평선" checked={g.horizon} onChange={(x) => patch('guides', { horizon: x })} disabled={!g.visible} />
        <Toggle label="히스토그램" checked={g.histogram} onChange={(x) => patch('guides', { histogram: x })} disabled={!g.visible} />
      </div>
    </Panel>
  );
}

/** 카메라 하드웨어 제어: 브라우저가 track.getCapabilities() 로 노출한 항목만 표시한다. */
export function HardwareControlsPanel() {
  const { session, locked, notify } = useStudio();
  const caps = session.camera.capabilities as Caps;
  const st = (session.camera.settings ?? {}) as Record<string, unknown>;
  const apply = async (c: Record<string, unknown>) => {
    const ok = await session.applyCameraConstraints(c);
    if (!ok) notify('warning', '카메라가 이 설정 변경을 거부했습니다. 장치가 해당 값을 지원하지 않을 수 있습니다.');
  };

  const ranges: { key: string; label: string }[] = [
    { key: 'exposureCompensation', label: '노출 보정' },
    { key: 'exposureTime', label: '노출 시간' },
    { key: 'iso', label: 'ISO' },
    { key: 'focusDistance', label: '초점 거리' },
    { key: 'colorTemperature', label: '색온도(K)' },
    { key: 'brightness', label: '밝기(하드웨어)' },
    { key: 'contrast', label: '대비(하드웨어)' },
    { key: 'saturation', label: '채도(하드웨어)' },
    { key: 'sharpness', label: '선명도(하드웨어)' },
  ];
  const modes: { key: string; label: string }[] = [
    { key: 'exposureMode', label: '노출 모드' },
    { key: 'focusMode', label: '초점 모드' },
    { key: 'whiteBalanceMode', label: '화이트밸런스 모드' },
  ];
  const MODE_LABEL: Record<string, string> = { continuous: '연속 자동', 'single-shot': '1회 자동', manual: '수동', none: '없음' };
  const availRanges = ranges.filter((r) => rangeCap(caps, r.key));
  const availModes = modes.filter((m) => listCap(caps, m.key));
  const torch = caps.torch === true || (Array.isArray(caps.torch) && (caps.torch as boolean[]).includes(true));
  const zoom = rangeCap(caps, 'zoom');
  const any = availRanges.length + availModes.length > 0 || torch || zoom;

  return (
    <Panel title="카메라 하드웨어 제어" icon="settings" defaultOpen={false} badge={<span className="badge">{any ? '지원 항목 있음' : '미지원'}</span>}>
      {session.camera.status !== 'live' ? (
        <p className="note">카메라가 연결되면 지원 항목을 확인합니다.</p>
      ) : !any ? (
        <p className="note" data-testid="hw-unsupported">
          이 브라우저/카메라는 노출·초점·화이트밸런스 같은 하드웨어 수동 제어를 제공하지 않습니다. 확대는 디지털 확대로,
          색 보정은 '미리보기 보정(소프트웨어)'으로 대체됩니다.
        </p>
      ) : (
        <>
          {zoom && <p className="note">하드웨어 줌 지원: {zoom.min}× ~ {zoom.max}× (미리보기의 확대 버튼이 카메라 줌을 사용합니다)</p>}
          {availModes.map((m) => {
            const list = listCap(caps, m.key) ?? [];
            return (
              <Select
                key={m.key}
                label={m.label}
                value={String(st[m.key] ?? list[0])}
                options={list.map((x) => ({ value: x, label: MODE_LABEL[x] ?? x }))}
                disabled={locked}
                onChange={(x) => void apply({ [m.key]: x })}
              />
            );
          })}
          {availRanges.map((r) => {
            const c = rangeCap(caps, r.key)!;
            const val = typeof st[r.key] === 'number' ? (st[r.key] as number) : c.min;
            return (
              <Range
                key={r.key}
                label={r.label}
                value={val}
                min={c.min}
                max={c.max}
                step={c.step || (c.max - c.min) / 100}
                disabled={locked}
                onChange={(x) => void apply({ [r.key]: x })}
                format={(x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2))}
              />
            );
          })}
          {torch && <Toggle label="플래시(토치)" checked={Boolean(st.torch)} onChange={(x) => void apply({ torch: x })} />}
        </>
      )}
      <p className="note">
        손떨림 보정: 웹 표준 API 로 상태를 확인하거나 제어할 수 없어 <b>확인 불가(미지원)</b>로 표시합니다. 일부 모바일 기기는
        운영체제 수준에서 자동 적용될 수 있습니다.
      </p>
    </Panel>
  );
}
