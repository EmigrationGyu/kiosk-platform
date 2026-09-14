import { describe, expect, test } from 'bun:test';
import { BRIDGE_METHOD } from 'kiosk-types';
import { createBridgeClient } from './createBridgeClient';
import type { MessageEventLike, MessageLike } from './types';

/**
 * 브리지 클라이언트 박제.
 *
 * 이 채널은 "부모만 할 수 있는 일"을 빌리는 통로라, 상관짓기(id)가 틀리면 엉뚱한 응답이
 * 엉뚱한 호출로 흘러간다. 그리고 리스너를 호출마다 달면 누적된다 — 지난주 실제로
 * 겪은 종류의 버그라 여기서 고정한다.
 */
function createFakePort() {
  const listeners: ((event: MessageEventLike) => void)[] = [];
  const sent: unknown[] = [];
  const port: MessageLike & {
    sent: unknown[];
    listenerCount: () => number;
    emit: (data: unknown, ports?: MessageLike[]) => void;
  } = {
    postMessage: (message) => {
      sent.push(message);
    },
    on: (_event, listener) => {
      listeners.push(listener);
    },
    start: () => undefined,
    sent,
    listenerCount: () => listeners.length,
    emit: (data, ports) => {
      for (const listener of [...listeners]) listener({ data, ports });
    },
  };
  return port;
}

const lastCallId = (port: { sent: unknown[] }): string =>
  (port.sent.at(-1) as { id: string }).id;

describe('브리지 클라이언트', () => {
  test('응답을 id 로 상관지어 해당 호출만 resolve 한다', async () => {
    const port = createFakePort();
    const client = createBridgeClient(port);

    const first = client.call(BRIDGE_METHOD.SECURE_GET, 'svc', 'a');
    const firstId = lastCallId(port);
    const second = client.call(BRIDGE_METHOD.SECURE_GET, 'svc', 'b');
    const secondId = lastCallId(port);

    // 순서를 뒤집어 응답해도 각자에게 간다.
    port.emit({ kind: 'result', id: secondId, ok: true, value: 'B' });
    port.emit({ kind: 'result', id: firstId, ok: true, value: 'A' });

    expect((await first).value).toBe('A');
    expect((await second).value).toBe('B');
  });

  test('실패 응답은 reject 된다', async () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const pending = client.call(BRIDGE_METHOD.SECURE_SET, 'svc', 'a', 'x');

    port.emit({
      kind: 'result',
      id: lastCallId(port),
      ok: false,
      error: '암호화 불가',
    });

    expect(pending).rejects.toThrow('암호화 불가');
  });

  test('호출을 반복해도 리스너가 누적되지 않는다', () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const before = port.listenerCount();

    for (let i = 0; i < 20; i++) {
      void client.call(BRIDGE_METHOD.SECURE_GET, 'svc', String(i));
    }

    expect(port.listenerCount()).toBe(before);
  });

  test('결과에 실려 온 포트를 함께 돌려준다 (spawn 용)', async () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const pending = client.call(BRIDGE_METHOD.PROCESS_SPAWN, {});
    const childPort = createFakePort();

    port.emit({ kind: 'result', id: lastCallId(port), ok: true, value: null }, [
      childPort,
    ]);

    expect((await pending).port).toBe(childPort);
  });

  test('렌더러 포트 전달은 구독자에게 간다 — 재배선이라 여러 번 온다', () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const received: MessageLike[] = [];
    client.onRendererPort((p) => received.push(p));

    const first = createFakePort();
    const second = createFakePort();
    port.emit({ kind: 'port', tag: 'renderer' }, [first]);
    port.emit({ kind: 'port', tag: 'renderer' }, [second]);

    expect(received).toEqual([first, second]);
  });

  test('자식 생명주기 통지가 구독자에게 간다', () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const seen: string[] = [];
    client.onProcessEvent((e) => seen.push(`${e.process}:${e.event}`));

    port.emit({
      kind: 'event',
      process: 'token-dispenser',
      event: 'exit',
      code: 0,
    });
    port.emit({
      kind: 'event',
      process: 'ime',
      event: 'stderr',
      text: 'x',
    });

    expect(seen).toEqual(['token-dispenser:exit', 'ime:stderr']);
  });

  test('해제하면 더 이상 받지 않는다 — 자식마다 배선하면 재spawn 마다 쌓인다 ★', () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const seen: string[] = [];
    const detach = client.onProcessEvent((e) => seen.push(e.event));

    port.emit({
      kind: 'event',
      process: 'token-dispenser',
      event: 'stdout',
      text: 'a',
    });
    detach();
    port.emit({
      kind: 'event',
      process: 'token-dispenser',
      event: 'stdout',
      text: 'b',
    });

    expect(seen).toEqual(['stdout']);
  });

  test('발화 중에 스스로 해제해도 뒤 구독자가 빠지지 않는다 ★', () => {
    const port = createFakePort();
    const client = createBridgeClient(port);
    const seen: string[] = [];

    const detach = client.onProcessEvent(() => {
      seen.push('첫째');
      detach();
    });
    client.onProcessEvent(() => seen.push('둘째'));

    port.emit({
      kind: 'event',
      process: 'token-dispenser',
      event: 'exit',
      code: 0,
    });

    // 배열을 직접 돌면 splice 로 인덱스가 밀려 둘째가 통째로 빠진다.
    expect(seen).toEqual(['첫째', '둘째']);
  });
});
