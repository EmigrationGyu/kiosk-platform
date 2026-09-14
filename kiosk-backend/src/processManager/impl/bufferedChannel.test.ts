import { describe, expect, test } from 'bun:test';
import type { MessageEventLike, MessageLike } from 'src/bridge/types';
import { createBufferedChannel } from './bufferedChannel';

/**
 * 포트 도착 전 송신 버퍼 박제.
 *
 * 이 버퍼가 있어야 `Spawner.spawn` 이 동기 계약을 유지할 수 있고, 그래야 소비처
 * (hardwareTransport)가 `ready` 를 기다리도록 고쳐지지 않는다 — "백엔드 코드는 안 바뀐다"
 * 는 이 페이즈의 전제가 여기 달려 있다.
 */
function createFakePort() {
  const listeners: ((event: MessageEventLike) => void)[] = [];
  const sent: unknown[] = [];
  const port: MessageLike & {
    sent: unknown[];
    emit: (data: unknown) => void;
  } = {
    postMessage: (m) => {
      sent.push(m);
    },
    on: (_e, l) => {
      listeners.push(l);
    },
    sent,
    emit: (data) => {
      for (const l of listeners) l({ data });
    },
  };
  return port;
}

describe('버퍼 채널', () => {
  test('포트 도착 전 송신은 순서대로 보관됐다 flush 된다', () => {
    const channel = createBufferedChannel();
    channel.postMessage({ n: 1 });
    channel.postMessage({ n: 2 });

    const port = createFakePort();
    expect(port.sent).toHaveLength(0); // 아직 아무것도 안 나감

    channel.attach(port);
    expect(port.sent).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test('attach 이후 송신은 곧바로 나간다', () => {
    const channel = createBufferedChannel();
    const port = createFakePort();
    channel.attach(port);

    channel.postMessage({ n: 3 });
    expect(port.sent).toEqual([{ n: 3 }]);
  });

  test('flush 는 한 번만 — 재전송되지 않는다', () => {
    const channel = createBufferedChannel();
    channel.postMessage({ n: 1 });

    const port = createFakePort();
    channel.attach(port);
    channel.postMessage({ n: 2 });

    expect(port.sent).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test('받은 메시지를 변형 없이 리스너에게 전달한다', () => {
    const channel = createBufferedChannel();
    const port = createFakePort();
    const seen: unknown[] = [];
    channel.on('message', (v) => seen.push(v));
    channel.attach(port);

    // 메인은 중계만 하므로 자식이 보낸 하드웨어 응답이 그대로 온다.
    const fromChild = { id: 'r1', ok: true, code: 200, result: { x: 1 } };
    port.emit(fromChild);

    expect(seen).toEqual([fromChild]);
  });

  test('off 한 리스너에게는 안 간다', () => {
    const channel = createBufferedChannel();
    const port = createFakePort();
    const seen: unknown[] = [];
    const listener = (v: unknown) => seen.push(v);
    channel.on('message', listener);
    channel.attach(port);
    channel.off('message', listener);

    port.emit({ id: 'r1', ok: true, code: 200 });
    expect(seen).toHaveLength(0);
  });
});
