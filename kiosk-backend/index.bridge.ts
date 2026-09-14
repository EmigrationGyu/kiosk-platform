import 'dotenv/config';
import { App } from './src/app';
import { createBridgeClient } from './src/bridge/createBridgeClient';
import { setBridgeClient } from './src/bridge/impl/parent';
import type { MessageLike } from './src/bridge/types';

/**
 * 자식 프로세스로 도는 백엔드의 엔트리.
 *
 * `index.ts` 와 갈라놓은 이유: 이쪽은 **부모와의 연결을 먼저 세운 뒤** App 을 만들어야
 * 한다. 하나의 엔트리에 분기를 두면 electron·node 타깃까지 브리지 개념을 알게 되고,
 * 그건 "타깃은 impl 만 갈아끼운다"는 규칙을 깨뜨린다.
 *
 * `process.parentPort` 는 electron import 가 아니라 utilityProcess 가 심어주는 프로세스
 * 속성이라, 이 번들은 여전히 electron 을 참조하지 않는다(forbid-electron 게이트 통과).
 * serialport 서브프로세스의 IPCServer 도 같은 방식을 쓴다.
 */
const parentPort = (
  globalThis.process as unknown as { parentPort?: MessageLike }
).parentPort;

if (!parentPort) {
  throw new Error(
    'parentPort 가 없습니다 — 이 번들은 utilityProcess 자식으로만 실행됩니다.',
  );
}

setBridgeClient(createBridgeClient(parentPort));

const app = new App();
app.start();
console.log('[ready]');
