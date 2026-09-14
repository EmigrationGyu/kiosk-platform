// biome-ignore-all lint/suspicious/noConsole: stdout/stderr 가 로그 전송로.
/**
 * Bootstrap — 동결 앵커. NSSM 이 `bun.exe bootstrap.js` 로 올리는 서비스 엔트리이고, loader.js 를
 * 자동 업데이트+감시+롤백한다(supervisor-core). 나쁜 loader 가 나가도 여기서 previous 로
 * 롤백하므로 loader 는 S3 로 원격 수정 가능하다 — 현장 USB 방문이 필요 없다는 뜻이다.
 *
 * 자신은 USB 로만 갱신되고 heartbeat 도 보내지 않는다(위에는 NSSM/SCM 의 프로세스-종료 감시만
 * 있다). supervisor-core 와 함께 환원 불가능한 프로즌 코어이므로 최대한 단순하게 유지할 것.
 */

import { LOADER_MANIFEST_URL, LOADER_PATH } from './constants';
import { runSupervisor } from './supervisor-core';

runSupervisor({
  label: 'loader',
  manifestUrl: LOADER_MANIFEST_URL,
  childPath: LOADER_PATH,
  enableUpdate: true, // S3 자동 업데이트 ON — bootstrap 이 loader.js 를 폴링/롤백
}).catch((err) => {
  console.error('[bootstrap] fatal', err);
  process.exit(1);
});
