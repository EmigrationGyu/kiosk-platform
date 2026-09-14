import path from 'node:path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      'kiosk-types': path.resolve(__dirname, '../kiosk-types'),
    },
  },
});
