// 모바일 환경 안내: 앱 내장 브라우저(카카오톡·네이버 등), 휴대폰에서 파일로 직접 연 경우, HTTPS 가 아닌 경우.

import { useMemo, useState } from 'react';
import { detectPlatform, externalOpenUrl } from '../core/mobile';
import { Icon } from './Icon';

export function useEnvironmentIssue() {
  return useMemo(() => {
    const p = detectPlatform();
    const browser = p.ios ? 'Safari' : 'Chrome';
    if (p.inApp) {
      return {
        platform: p,
        title: `${p.inApp} 안의 브라우저에서는 카메라·마이크가 막힐 수 있습니다`,
        detail: p.ios
          ? `오른쪽 아래(또는 위) ··· / 공유 메뉴에서 'Safari로 열기'를 눌러 주세요.`
          : `아래 버튼을 누르거나 메뉴에서 '다른 브라우저로 열기'를 선택해 ${browser}에서 열어 주세요.`,
        openUrl: externalOpenUrl(p, location.href),
        browser,
      };
    }
    if (p.mobile && p.fileProtocol) {
      return {
        platform: p,
        title: '휴대폰에서는 HTML 파일을 직접 열면 카메라가 차단됩니다',
        detail: `이 파일을 HTTPS 웹 주소(예: GitHub Pages, Netlify)에 올린 뒤 그 주소를 ${browser}에서 열어 주세요.`,
        openUrl: null,
        browser,
      };
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return {
        platform: p,
        title: 'HTTPS 주소가 아니어서 카메라를 사용할 수 없습니다',
        detail: `주소를 https:// 로 바꿔 접속하세요. 같은 Wi-Fi 의 PC에서 띄운 개발 서버라면 'npm run dev:https' 로 실행하세요.`,
        openUrl: null,
        browser,
      };
    }
    return null;
  }, []);
}

export function EnvironmentNotice() {
  const issue = useEnvironmentIssue();
  const [hidden, setHidden] = useState(false);
  if (!issue || hidden) return null;
  return (
    <div className="env-notice" role="alert" data-testid="env-notice">
      <Icon name="alert" size={18} />
      <div className="env-notice__text">
        <b>{issue.title}</b>
        <span>{issue.detail}</span>
      </div>
      <div className="env-notice__actions">
        {issue.openUrl && (
          <a className="btn btn--primary btn--sm" href={issue.openUrl} data-testid="open-external">
            {issue.browser}로 열기
          </a>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            void navigator.clipboard?.writeText(location.href).catch(() => undefined);
          }}
        >
          주소 복사
        </button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => setHidden(true)} aria-label="안내 닫기">
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
