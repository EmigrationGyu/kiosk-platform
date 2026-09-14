import type { BridgeClient } from '../types';

/**
 * bootstrap 이 주입한 브리지 클라이언트에 대한 접근자.
 *
 * 모듈 로드 시점에 연결이 준비돼 있다는 보장이 없어(부모의 init 메시지가 먼저 와야 한다)
 * 상수가 아니라 함수로 노출한다. 준비 전에 부르면 조용히 undefined 를 흘리지 않고
 * 즉시 실패시킨다 — 그 시점 착오는 나중에 타임아웃으로 둔갑해 진단이 어려워진다.
 */
let client: BridgeClient | null = null;

export function setBridgeClient(next: BridgeClient): void {
  client = next;
}

export function bridge(): BridgeClient {
  if (!client) {
    throw new Error(
      'Bridge client 미설정 — backend-bootstrap 이 setBridgeClient 를 먼저 호출해야 합니다.',
    );
  }
  return client;
}
