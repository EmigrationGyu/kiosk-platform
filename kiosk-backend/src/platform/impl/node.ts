import path from 'node:path';
import { ARTIFACT_ROOT_DIR } from 'kiosk-types';
import { KIOSK_HOME_DIR } from 'src/constant/LogPaths';
import type { Platform } from '../types';

/**
 * electron 비의존 Platform — 개발(vite-node)과 향후 pm2/Linux 배포용.
 * 단말 로컬 데이터 루트(~/.kiosk)에서 파생한다.
 */
export const platform: Platform = {
  paths: {
    userData: path.join(KIOSK_HOME_DIR, 'userData'),
    // 비-electron 배포의 아티팩트 루트. 개발에선 소비처가 없다 — dev.ts 가 각 서브프로세스를
    // 소스에서 직접 띄우므로 교체 대상 아티팩트라는 개념 자체가 없다.
    baseline: path.join(KIOSK_HOME_DIR, ARTIFACT_ROOT_DIR),
  },
  appVersion:
    process.env.APP_VERSION ?? process.env.npm_package_version ?? 'unknown',
  isPackaged: false,
};
