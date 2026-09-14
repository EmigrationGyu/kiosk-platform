import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // stage-3 데코레이터(@EnsureDevice)를 dev(vite-node)에서 lower하기 위해 필수.
  // tsconfig target=ESNext 면 esbuild가 "런타임이 데코레이터를 네이티브 지원"한다고
  // 보고 lower하지 않아, Node가 raw `@` 구문을 만나 SyntaxError로 죽는다.
  // (prod esbuild.config.mjs 는 target=node20 이라 이미 lower됨 — 여기만 보정.)
  esbuild: { target: 'es2022' },
  resolve: {
    alias: {
      // tsconfig baseUrl: "." 에 대응 — bare 'src/' import 해석
      src: resolve(__dirname, './src'),
      // 개발 기본값은 루프백 — 실물 없이 탐지부터 I/O 까지 같은 경로로 돈다.
      // 실장비를 붙일 땐 이 줄만 impl/real.ts 로 돌린다.
      '@serial/Port': resolve(
        __dirname,
        './src/serialPortScanner/impl/loopback.ts',
      ),
      '@channel/Channel': resolve(
        __dirname,
        './src/helpers/channel/impl/socket.ts',
      ),
      '@storage/SecureStorage': resolve(
        __dirname,
        './src/helpers/storage/impl/keytar.ts',
      ),
      '@hardwareTransport/Transport': resolve(
        __dirname,
        './src/hardwareTransport/impl/express-ipc.ts',
      ),
      '@bridge/Bridge': resolve(__dirname, './src/bridge/impl/absent.ts'),
      '@platform/Platform': resolve(__dirname, './src/platform/impl/node.ts'),
      '@processManager/Manager': resolve(
        __dirname,
        './src/processManager/impl/node.ts',
      ),
    },
  },
  ssr: {
    external: ['serialport', '@serialport/*', 'keytar', 'express-ipc'],
  },
});
