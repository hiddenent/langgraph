import { useEffect, useMemo, useState } from 'react';
import { detectFeatures } from '../core/capabilities';
import { getSupportedFormats } from '../core/codecs';
import { queryPermission } from '../core/devices';
import { DEFAULT_SETTINGS } from '../core/settings';
import { useStudio } from '../StudioContext';
import { Icon } from './Icon';
import { AudioSettingsPanel, DevicePanel, DeviceState } from './Panels';
import { ConfirmDialog, Panel, StatusPill, Toggle } from './ui';

export function SettingsPage() {
  const { session, settings, patch, update, photo, notify, locked } = useStudio();
  const features = useMemo(() => detectFeatures(), []);
  const videoFormats = useMemo(() => getSupportedFormats(true), []);
  const videoOnlyFormats = useMemo(() => getSupportedFormats(false), []);
  const [perm, setPerm] = useState<{ camera: string; microphone: string }>({ camera: 'unknown', microphone: 'unknown' });
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const load = async () => setPerm({ camera: await queryPermission('camera'), microphone: await queryPermission('microphone') });
    void load();
  }, [session.camera.status, session.mic.status]);

  const permLabel = (p: string) => (p === 'granted' ? '허용됨' : p === 'denied' ? '거부됨' : p === 'prompt' ? '요청 전(묻기)' : '확인 불가');

  return (
    <div className="page" data-testid="settings-page">
      <h2>장치 및 환경 설정</h2>
      <div className="page__grid">
        <div>
          <DevicePanel />
          <Panel title="권한 및 사용 상태" icon="shield">
            <dl className="kv">
              <dt>카메라 권한</dt>
              <dd>{permLabel(perm.camera)}</dd>
              <dt>마이크 권한</dt>
              <dd>{permLabel(perm.microphone)}</dd>
              <dt>카메라</dt>
              <dd>
                <DeviceState status={session.camera.status} />
              </dd>
              <dt>마이크</dt>
              <dd>
                <DeviceState status={session.mic.status} />
              </dd>
            </dl>
            <div className="row">
              {session.started ? (
                <button type="button" className="btn btn--danger-ghost" onClick={session.stopAll} disabled={locked} data-testid="stop-devices">
                  <Icon name="power" /> 카메라·마이크 사용 종료
                </button>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => void session.start()}>
                  <Icon name="camera" /> 카메라·마이크 시작
                </button>
              )}
            </div>
            <p className="note">사용 종료 시 모든 카메라·마이크 트랙과 오디오 분석기를 해제하며 브라우저의 '사용 중' 표시가 꺼집니다.</p>
          </Panel>
          <AudioSettingsPanel />
        </div>
        <div>
          <Panel title="환경 설정" icon="settings">
            <Toggle label="카운트다운·녹화 시작 효과음" checked={settings.ui.countdownSound} onChange={(x) => patch('ui', { countdownSound: x })} />
            <Toggle label="녹화 중 설정 패널 자동 접기" checked={settings.ui.collapseWhileRecording} onChange={(x) => patch('ui', { collapseWhileRecording: x })} />
            <Toggle
              label="사진 모드에서도 마이크 유지"
              checked={settings.ui.keepMicInPhoto}
              onChange={(x) => patch('ui', { keepMicInPhoto: x })}
              hint="끄면 사진 모드에서 마이크를 해제합니다(개인정보 보호)."
            />
            <Toggle
              label="권한이 이미 허용된 경우 시작 시 자동 연결"
              checked={settings.ui.autoStart}
              onChange={(x) => patch('ui', { autoStart: x })}
            />
            <Toggle
              label="휴대폰 세로 방향 자동 맞춤"
              checked={settings.ui.autoOrient}
              onChange={(x) => patch('ui', { autoOrient: x })}
              hint="휴대폰을 세로로 들면 16:9·4:3 설정을 9:16·3:4 로 자동 전환합니다."
            />
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmReset(true)}>
              <Icon name="refresh" /> 모든 설정 초기화
            </button>
          </Panel>
          <Panel title="브라우저 기능 지원 현황" icon="info">
            <table className="table" data-testid="feature-table">
              <thead>
                <tr>
                  <th>기능</th>
                  <th>지원</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.label}
                      {f.note && <small className="muted"> — {f.note}</small>}
                    </td>
                    <td>
                      <StatusPill ok={f.supported} label={f.supported ? '지원' : '미지원'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="녹화·이미지 형식 지원" icon="video" defaultOpen={false}>
            <div className="subhead">동영상(오디오 포함)</div>
            <ul className="list" data-testid="formats-av">
              {videoFormats.length ? videoFormats.map((f) => <li key={f.mimeType}>{f.label} <code>{f.mimeType}</code></li>) : <li>없음</li>}
            </ul>
            <div className="subhead">동영상(오디오 없음)</div>
            <ul className="list">
              {videoOnlyFormats.length ? videoOnlyFormats.map((f) => <li key={f.mimeType}>{f.label} <code>{f.mimeType}</code></li>) : <li>없음</li>}
            </ul>
            <div className="subhead">사진</div>
            <ul className="list">
              {photo.imageFormats.map((f) => (
                <li key={f.mime}>
                  {f.label} <code>{f.mime}</code>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      {confirmReset && (
        <ConfirmDialog
          title="설정 초기화"
          message="모든 촬영·장치 설정을 기본값으로 되돌릴까요? 촬영한 파일은 삭제되지 않습니다."
          confirmLabel="초기화"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            update(() => DEFAULT_SETTINGS);
            notify('info', '설정을 초기화했습니다.');
          }}
        />
      )}
    </div>
  );
}
