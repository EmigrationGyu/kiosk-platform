import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';
import { lottieSanitize } from './vite-plugins/lottie-sanitize';
// Node 내장 타입 선언이 없는 환경을 고려해 절대경로 해석 없이 Vite의 루트상대 경로 alias를 사용합니다.

// https://vite.dev/config/
// __dirname 계산을 제거합니다.

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  const isMock = mode === 'mock';

  // 프로덕션은 메인이 깔아준 백엔드 직결 포트를 쓴다 — 백엔드가 메인 밖(자식 프로세스)에
  // 있어 ipcRenderer.invoke 의 상대(ipcMain.handle)가 없다. 개발은 socket.io 그대로.
  const transportImpl = isMock
    ? '/src/shared/transport/impl/mock.ts'
    : isProd
      ? '/src/shared/transport/impl/messagePort.ts'
      : '/src/shared/transport/impl/socket.ts';

  return {
    base: './',
    // Vite 8 의 forwardConsole(브라우저 콘솔/에러를 dev 서버로 전달)은 HMR WebSocket 이
    // 연결돼 있을 때만 동작한다. ws 가 미연결인 환경에서는 unhandledrejection 전달이
    // ws.send(undefined) 로 throw 하고, 그 throw 가 다시 unhandledrejection 을 만들어
    // 자기증식 무한 루프(client:438)가 된다. 끄면 Vite 7 과 동일 동작.
    server: {
      forwardConsole: false,
    },
    plugins: [
      lottieSanitize(),
      svgr({
        svgrOptions: {
          exportType: 'default',
        },
      }),
      react(),
      // plugin-react v6 부터 내부 Babel 이 Oxc 로 교체됨. React Compiler 는 여전히
      // Babel 전용이므로 별도 Babel 패스로 분리해 주입한다(공식 권장 패턴).
      babel({ presets: [reactCompilerPreset()] }),
    ],
    resolve: {
      alias: {
        '@': '/src',
        // 환경별 트랜스포트 구현을 하나의 import로 통일: import { Transport } from 'transport/Transport'
        'transport/Transport': transportImpl,
        // 환경별 Apollo Client 구현: mock 모드에서는 mutation을 가로채는 버전 사용
        'apollo/apolloClient': isMock
          ? '/src/shared/api/apolloClient.mock.ts'
          : '/src/shared/api/apolloClient.ts',
        // mock 모드에서는 GraphQL subscription 대신 PMS 미리보기 postMessage 채널 사용
        'effects/useKioskSystemNotificationEffect': isMock
          ? '/src/app/providers/effects/useKioskSystemNotificationEffect.mock.ts'
          : '/src/app/providers/effects/useKioskSystemNotificationEffect.ts',
        'lottie-react': 'lottie-react/build/index.es.js',
      },
      dedupe: ['react', 'react-dom'],
    },
    define: {
      __MOCK_MODE__: JSON.stringify(isMock),
    },
    optimizeDeps: {
      exclude: ['kiosk-types'],
    },
  };
});
