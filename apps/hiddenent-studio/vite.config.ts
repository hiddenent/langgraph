/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// 배포 빌드에만 CSP 를 넣는다(개발 서버의 HMR 인라인 스크립트와 충돌하므로).
// connect-src 'self' 로 미디어가 외부 서버로 전송될 수 있는 경로를 차단한다.
const CSP =
  "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

function cspPlugin(): Plugin {
  return {
    name: 'hiddenent-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// `npm run dev:https` 는 자체 서명 인증서 기반 HTTPS 개발 서버를 띄운다.
// 같은 네트워크의 모바일 기기에서 카메라를 테스트할 때 필요하다(카메라 API는 보안 컨텍스트 전용).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), cspPlugin(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
}));
