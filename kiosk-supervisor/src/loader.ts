// biome-ignore-all lint/suspicious/noConsole: stdout/stderr 가 로그/heartbeat 전송로.
/**
 * Loader — bootstrap 이 감시하는 중간 계층.
 *
 * 책임: daemon.js 를 자동 업데이트+감시+롤백 (supervisor-core) + 자신의 생존을
 * bootstrap 에게 heartbeat 로 송신. bootstrap 이 이 loader 를 롤백할 수 있으므로
 * loader 는 (bootstrap 과 달리) S3 로 자유롭게 업데이트 가능하다.
 */

import { DAEMON_MANIFEST_URL, DAEMON_PATH, LOADER_VERSION } from './constants';
import { startHeartbeat } from './heartbeat';
import { runSupervisor } from './supervisor-core';

// bootstrap 의 워치독이 보는 heartbeat.
startHeartbeat(() => LOADER_VERSION);

runSupervisor({
  label: 'daemon',
  manifestUrl: DAEMON_MANIFEST_URL,
  childPath: DAEMON_PATH,
  enableUpdate: true, // S3 자동 업데이트 ON — loader 가 daemon.js 를 폴링/롤백
}).catch((err) => {
  console.error('[loader] fatal', err);
  process.exit(1);
});
