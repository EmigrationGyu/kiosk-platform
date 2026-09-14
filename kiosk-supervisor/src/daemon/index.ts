/**
 * Daemon 엔트리 — 로더가 S3 에서 받아 실행하는 제품 코드(빌드 → 서명 → S3 업로드로 자유 업데이트).
 * 전체 설계는 ../../README.md 참조.
 *
 * v0 책임: heartbeat.ts(로더에게 생존 송신) · kiosk-watch.ts(키오스크 감시 + 재기동).
 */

import { DAEMON_VERSION } from '../constants';
import { startHeartbeat } from '../heartbeat';
import { startKioskWatch } from './kiosk-watch';
import { log } from './log';

function main(): void {
  log(`start v${DAEMON_VERSION}`);

  const stopHeartbeat = startHeartbeat(() => DAEMON_VERSION);
  const stopKioskWatch = startKioskWatch();

  const shutdown = () => {
    stopHeartbeat();
    stopKioskWatch();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
