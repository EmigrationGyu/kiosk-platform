import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // types 를 **소스로** 참조한다 — 키오스크가 쓰는 것과 같은 값을 보게 하려면
  // 사본이 아니라 원본이어야 한다(prefix 를 규칙으로 조립했다가 프론트에서 어긋난 적이 있다).
  server: { fs: { allow: ['..'] } },
});
