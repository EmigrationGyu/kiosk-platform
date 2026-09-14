import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../..'),
      '@ipc/Router': resolve(
        __dirname,
        '../../shared/IPCServer/impl/express-ipc.ts',
      ),
      // 부모가 stdout 을 읽는 토폴로지 — 로그 파일은 백엔드가 단독으로 소유한다.
      '@log/Sink': resolve(__dirname, '../../shared/Logger/impl/stdout.ts'),
      // dev 기본값은 루프백 — 하드웨어 없이 전 스택이 돈다.
      // 실장비를 붙일 땐 이 줄만 impl/real.ts 로 돌린다.
      '@serial/Port': resolve(
        __dirname,
        '../../shared/SerialPort/impl/loopback.ts',
      ),
    },
  },
  ssr: {
    external: ['serialport', '@serialport/*', 'express-ipc'],
  },
});
