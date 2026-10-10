/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';

// 배포 빌드에만 CSP 를 넣는다(개발 서버의 HMR 인라인 스크립트와 충돌하므로).
// connect-src 'self' 로 미디어가 외부 서버로 전송될 수 있는 경로를 차단한다.
const CSP =
  "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

// 단일 HTML 파일 빌드는 스크립트가 인라인으로 들어가므로 script-src 에 'unsafe-inline' 이 필요하다.
// 외부 전송 차단(connect-src)은 그대로 유지한다.
const CSP_SINGLE = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");

function cspPlugin(single: boolean): Plugin {
  return {
    name: 'hiddenent-csp',
    apply: 'build',
    transformIndexHtml(html) {
      let out = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${single ? CSP_SINGLE : CSP}" />`);
      if (single) {
        // 파비콘도 파일 안에 넣어 HTML 하나만으로 완결되게 한다.
        const svg = fs.readFileSync(new URL('./public/favicon.svg', import.meta.url), 'utf8');
        out = out.replace('href="./favicon.svg"', `href="data:image/svg+xml,${encodeURIComponent(svg)}"`);
      }
      return out;
    },
  };
}

// `npm run build:single` 은 JS·CSS 를 모두 인라인한 HTML 파일 하나(standalone/hiddenent-studio.html)를 만든다.
// `npm run dev:https` 는 자체 서명 인증서 기반 HTTPS 개발 서버를 띄운다.
// 같은 네트워크의 모바일 기기에서 카메라를 테스트할 때 필요하다(카메라 API는 보안 컨텍스트 전용).
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
  base: './',
  publicDir: single ? false : 'public',
  plugins: [react(), cspPlugin(single), ...(single ? [viteSingleFile()] : []), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: single
    ? { target: 'es2020', sourcemap: false, outDir: 'standalone', emptyOutDir: true }
    : { target: 'es2020', sourcemap: false },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
  };
});
