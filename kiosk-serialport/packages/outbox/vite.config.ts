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
      // drizzle 드라이버의 최상단 import 를 받아내는 스텁 (생성되지 않는다).
      'better-sqlite3': resolve(__dirname, 'src/db/betterSqliteStub.ts'),
    },
  },
  ssr: {
    external: ['express-ipc'],
    // drizzle 를 externalize 하면 node 가 driver.js 를 직접 로드해 위 alias 를 건너뛰고
    // 없는 better-sqlite3 를 찾다 부팅이 죽는다 — vite 가 변환해야 스텁이 걸린다.
    noExternal: ['drizzle-orm'],
  },
});
