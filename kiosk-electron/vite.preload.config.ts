import path from 'node:path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      // preload 도 types 소스를 직접 참조한다 (포트 핸드오프 신호 공유).
      'kiosk-types': path.resolve(__dirname, '../kiosk-types'),
    },
  },
});
