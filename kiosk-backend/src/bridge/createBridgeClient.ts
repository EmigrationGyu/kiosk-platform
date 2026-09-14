import {
  type BridgeEvent,
  type BridgeMethod,
  isBridgeEvent,
  isBridgeResult,
  isPortHandoff,
  type PortMessage,
} from 'kiosk-types';
import type { BridgeClient, MessageLike } from './types';

/**
 * 부모(electron 메인)와의 RPC 클라이언트.
 *
 * 요청/응답 트래픽은 이 채널로 흐르지 않는다 — 그건 전달받은 별도 포트가 나른다.
 * 여기로는 **부모만 할 수 있는 일**(safeStorage·프로세스 fork)과 포트 전달만 오간다.
 * 그래서 이 채널이 바빠지면 경계가 새고 있다는 신호다.
 *
 * 리스너는 생성 시 **한 번만** 등록하고 id 로 상관짓는다 — 호출마다 리스너를 달면
 * 호출 수만큼 누적된다.
 */
export function createBridgeClient(parent: MessageLike): BridgeClient {
  type Pending = {
    resolve: (value: { value: unknown; port: MessageLike | null }) => void;
    reject: (error: Error) => void;
  };
  const pending = new Map<string, Pending>();
  const rendererPortListeners: ((port: MessageLike) => void)[] = [];
  const processEventListeners: ((event: BridgeEvent) => void)[] = [];

  parent.on('message', (event) => {
    const message = event.data as PortMessage;

    // 렌더러 포트 전달 — 재기동·재배선 때마다 다시 온다.
    if (isPortHandoff(message)) {
      const port = event.ports?.[0];
      if (!port) return;
      port.start?.();
      for (const listener of rendererPortListeners) listener(port);
      return;
    }

    if (isBridgeEvent(message)) {
      // 사본을 돈다 — 리스너가 발화 중에 자신을 뗄 수 있다(exit 이 그렇다).
      for (const listener of [...processEventListeners]) listener(message);
      return;
    }

    if (!isBridgeResult(message)) return;

    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);

    if (message.ok) {
      // spawn 처럼 결과에 포트가 실려 오는 호출이 있다. 없으면 null.
      const port = event.ports?.[0] ?? null;
      port?.start?.();
      waiter.resolve({ value: message.value, port });
      return;
    }
    waiter.reject(new Error(message.error));
  });
  parent.start?.();

  return {
    call(method: BridgeMethod, ...args: unknown[]) {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        parent.postMessage({ kind: 'call', id, method, args });
      });
    },
    onRendererPort(listener) {
      rendererPortListeners.push(listener);
    },
    onProcessEvent(listener) {
      processEventListeners.push(listener);
      return () => {
        const at = processEventListeners.indexOf(listener);
        if (at >= 0) processEventListeners.splice(at, 1);
      };
    },
  };
}
