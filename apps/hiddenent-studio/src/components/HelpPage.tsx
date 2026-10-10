import { Icon } from './Icon';

const SHORTCUTS: [string, string][] = [
  ['Space', '사진 촬영 / 녹화 시작·종료(현재 모드에 따라)'],
  ['V', '동영상 모드'],
  ['P', '사진 모드'],
  ['M', '마이크 음소거 전환'],
  ['G', '구도 가이드 표시/숨기기'],
  ['Esc', '대화상자 닫기, 카운트다운·연속 촬영 취소, 녹화 중이면 취소 확인 창 열기'],
];

export function HelpPage() {
  return (
    <div className="page help" data-testid="help-page">
      <h2>도움말 및 단축키</h2>
      <section className="panel panel--open">
        <h3 className="panel__title">
          <Icon name="keyboard" /> 키보드 단축키
        </h3>
        <table className="table">
          <thead>
            <tr>
              <th>키</th>
              <th>동작</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list">
          <li>입력창에서 글자를 입력하는 중에는 단축키가 동작하지 않습니다.</li>
          <li>녹화 중에는 V/P 모드 전환이 막혀 있어 실수로 녹화가 끊기지 않습니다. Space 는 녹화를 '저장하며' 종료합니다.</li>
          <li>Esc 는 녹화를 바로 지우지 않고 확인 창을 엽니다.</li>
          <li>키보드로 버튼에 포커스가 있을 때 Space 는 해당 버튼을 누릅니다(접근성).</li>
        </ul>
      </section>

      <section className="panel panel--open">
        <h3 className="panel__title">
          <Icon name="help" /> 문제 해결
        </h3>
        <dl className="faq">
          <dt>카메라/마이크 권한을 거부했어요</dt>
          <dd>
            주소창 왼쪽 자물쇠(사이트 정보) 아이콘 → 카메라·마이크를 '허용'으로 바꾼 뒤 새로고침하세요. macOS 는 시스템 설정 →
            개인정보 보호 및 보안 → 카메라/마이크, Windows 는 설정 → 개인정보 → 카메라/마이크에서 브라우저 접근을 허용해야 합니다.
          </dd>
          <dt>"다른 앱에서 사용 중" 오류가 나요</dt>
          <dd>Zoom, Teams, OBS, 다른 브라우저 탭처럼 카메라를 쓰는 프로그램을 닫은 뒤 '다시 시도'를 누르세요.</dd>
          <dt>장치 이름이 '카메라 1'처럼 보여요</dt>
          <dd>브라우저는 권한을 허용하기 전에는 장치 이름을 알려주지 않습니다. '카메라·마이크 시작' 후 목록이 갱신됩니다.</dd>
          <dt>오디오 미터의 dBFS 는 무엇인가요?</dt>
          <dd>
            dBFS 는 디지털 신호의 최대치(0 dBFS) 대비 상대 레벨입니다. 실제 소리 크기(dB SPL)나 마이크 하드웨어 게인을 뜻하지
            않습니다. 대화 녹음은 피크가 -12 ~ -6 dBFS 정도가 적당하며, 0 dBFS 에 닿으면 소리가 찌그러집니다(클리핑).
            미터는 화면 표시 전용이며 스피커로 소리를 내보내지 않습니다.
          </dd>
          <dt>선택한 해상도·프레임 레이트가 적용되지 않아요</dt>
          <dd>카메라가 지원하지 않는 값은 가장 가까운 값으로 열립니다. 실제 적용 값은 미리보기 왼쪽 아래와 동영상 설정에 표시됩니다.</dd>
          <dt>녹화한 파일이 다른 플레이어에서 재생되지 않아요</dt>
          <dd>
            WebM 은 일부 기본 플레이어(구형 Windows/QuickTime)에서 재생되지 않습니다. MP4 를 지원하는 브라우저에서는 녹화 형식을
            MP4 로 선택하거나, VLC 같은 플레이어를 사용하세요.
          </dd>
          <dt>탭을 닫으면 파일이 사라지나요?</dt>
          <dd>
            '임시(메모리)' 표시 파일은 탭을 닫으면 사라집니다. 다운로드하거나 라이브러리에서 '브라우저에 보관'을 눌러 로컬
            저장소(IndexedDB)에 저장하세요. 브라우저 저장소는 용량 제한이 있으며 시크릿 모드에서는 닫을 때 삭제됩니다.
          </dd>
          <dt>모바일에서 카메라가 열리지 않아요</dt>
          <dd>
            HTTPS 주소로 접속해야 합니다. iOS 는 Safari(또는 iOS 14.3 이상의 WebKit 기반 브라우저)에서 동작하며, 다른 앱으로
            전환하면 카메라가 중단될 수 있습니다.
          </dd>
        </dl>
      </section>

      <section className="panel panel--open">
        <h3 className="panel__title">
          <Icon name="shield" /> 개인정보 보호
        </h3>
        <ul className="list">
          <li>카메라·마이크는 '카메라·마이크 시작'을 누른 뒤에만 사용합니다. 사용 중에는 상단에 빨간 표시가 나타납니다.</li>
          <li>촬영한 미디어는 브라우저 안에서만 처리되며 서버로 전송하지 않습니다. 다운로드는 사용자가 버튼을 눌렀을 때만 실행됩니다.</li>
          <li>'장치 및 환경 설정 → 카메라·마이크 사용 종료' 또는 페이지를 닫으면 모든 트랙과 오디오 자원이 해제됩니다.</li>
          <li>오류 메시지와 로그에는 미디어 데이터를 포함하지 않습니다.</li>
        </ul>
      </section>
    </div>
  );
}
