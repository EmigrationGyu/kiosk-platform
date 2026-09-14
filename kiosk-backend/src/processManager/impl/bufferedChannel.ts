import { isPortResponse, type PortMessage } from 'kiosk-types';
import type { MessageLike } from 'src/bridge/types';

type MessageListener = (value: unknown) => void;

/** electron impl 의 채널과 같은 모양 — transport 는 어느 타깃인지 모른다. */
export type BufferedChannel = {
  postMessage(message: unknown): void;
  on(event: 'message', listener: MessageListener): void;
  off(event: 'message', listener: MessageListener): void;
};

export type AttachableChannel = BufferedChannel & {
  attach(port: MessageLike): void;
};

/**
 * 포트가 도착하기 전의 송신을 담아뒀다 flush 하는 채널.
 *
 * `Spawner.spawn` 은 동기 계약인데 부모에게 fork 를 요청하는 건 왕복이다. 이 버퍼가
 * 없으면 소비처(hardwareTransport)가 `ready` 를 기다리도록 고쳐져야 하는데, 그러면
 * "백엔드 코드는 안 바뀐다"는 전제가 깨진다.
 *
 * 순서는 보존한다 — 하드웨어 명령은 순서가 곧 의미인 경우가 많다.
 */
export function createBufferedChannel(): AttachableChannel {
  let port: MessageLike | null = null;
  const outbox: unknown[] = [];
  const listeners = new Set<MessageListener>();

  return {
    attach(next) {
      port = next;
      next.on('message', (event) => {
        // 이 포트는 자식 하나와의 전용선이라 오가는 것은 전부 그 하드웨어 프로토콜이다.
        // 메인은 중계만 하고 모양을 바꾸지 않으므로, transport 는 in-process 때와
        // 완전히 동일한 메시지를 본다.
        for (const listener of listeners) listener(event.data);
      });
      for (const queued of outbox) next.postMessage(queued);
      outbox.length = 0;
    },
    postMessage(message) {
      if (port) {
        port.postMessage(message);
        return;
      }
      outbox.push(message);
    },
    on(_event, listener) {
      listeners.add(listener);
    },
    off(_event, listener) {
      listeners.delete(listener);
    },
  };
}
