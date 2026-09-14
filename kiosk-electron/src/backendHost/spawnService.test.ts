import { describe, expect, test } from 'bun:test';
import {
  type ChildEvent,
  type ChildLike,
  createSpawnService,
  type PortLike,
} from './spawnService';

/**
 * fork 대행소 박제.
 *
 * 제일 중요한 건 **멱등성**이다. 백엔드가 respawn 되면 자기 목록을 잃는데, 여기서
 * 매번 새로 fork 하면 같은 디바이스에 두 프로세스가 붙어 COM 포트 EBUSY 가 난다
 * (Phase 2 에서 이중 spawn 을 막느라 공들인 바로 그 사고). 살아있으면 포트만 새로
 * 발급하는 성질이 재입양 API 를 불필요하게 만든다.
 */
function createFakePort(): PortLike & {
  sent: unknown[];
  closed: boolean;
  emit: (data: unknown) => void;
} {
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const port = {
    sent: [] as unknown[],
    closed: false,
    postMessage: (m: unknown) => port.sent.push(m),
    on: (_e: 'message', l: (e: { data: unknown }) => void) => {
      listeners.push(l);
    },
    start: () => undefined,
    close: () => {
      port.closed = true;
    },
    emit: (data: unknown) => {
      for (const l of listeners) l({ data });
    },
  };
  return port;
}

function createHarness() {
  const forked: string[] = [];
  const events: ChildEvent[] = [];
  const children: {
    sent: unknown[];
    killed: boolean;
    emit: (m: unknown) => void;
    exit: (code: number | null) => void;
  }[] = [];
  const channels: {
    port1: ReturnType<typeof createFakePort>;
    port2: ReturnType<typeof createFakePort>;
  }[] = [];

  const forkedExecPaths: (string | undefined)[] = [];

  const service = createSpawnService({
    fork: (entry, execPath): ChildLike => {
      forked.push(entry);
      forkedExecPaths.push(execPath);
      const listeners: ((m: unknown) => void)[] = [];
      let onExit: (code: number | null) => void = () => undefined;
      const child = {
        sent: [] as unknown[],
        killed: false,
        emit: (m: unknown) => {
          for (const l of listeners) l(m);
        },
        exit: (code: number | null) => onExit(code),
      };
      children.push(child);
      return {
        postMessage: (m) => child.sent.push(m),
        on: (_e, l) => {
          listeners.push(l);
        },
        onExit: (l) => {
          onExit = l;
        },
        onStdout: () => undefined,
        onStderr: () => undefined,
        kill: () => {
          child.killed = true;
        },
      };
    },
    createChannel: () => {
      const pair = { port1: createFakePort(), port2: createFakePort() };
      channels.push(pair);
      return pair;
    },
    notify: (e) => events.push(e),
  });

  return { service, forked, forkedExecPaths, events, children, channels };
}

describe('fork 대행소', () => {
  test('처음 요청하면 자식을 띄운다', () => {
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/target/cash/index.js');

    expect(h.forked).toEqual(['/target/cash/index.js']);
  });

  test('execPath 를 그대로 전달한다 — 왜인지는 여기가 모른다', () => {
    const h = createHarness();
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/node.exe');

    expect(h.forkedExecPaths).toEqual(['/rt/node.exe']);
  });

  test('execPath 가 없으면 호스트 런타임으로 띄운다', () => {
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/target/cash/index.js');

    expect(h.forkedExecPaths).toEqual([undefined]);
  });

  test('이미 도는 자식의 런타임은 바꾸지 않는다 — 재요청은 포트만 새로 준다', () => {
    const h = createHarness();
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/node.exe');
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/다른것.exe');

    expect(h.forked).toEqual(['/target/tmr/index.js']);
    expect(h.forkedExecPaths).toEqual(['/rt/node.exe']);
  });

  test('어긋난 런타임 재요청은 조용히 넘기지 않는다', () => {
    // execPath 는 정적 선언에서 파생해 런타임 중에 안 바뀐다 — 이 알림이 뜨면 다른 곳의
    // 버그다. 조용하면 "왜 새 런타임이 반영 안 되지"가 진단 불가능해진다.
    const h = createHarness();
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/node.exe');
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/다른것.exe');

    const notified = h.events.filter((e) => e.event === 'stderr');
    expect(notified).toHaveLength(1);
    expect(notified[0]?.text).toContain('/rt/node.exe');
    expect(notified[0]?.text).toContain('/rt/다른것.exe');
  });

  test('같은 런타임 재요청은 조용하다', () => {
    const h = createHarness();
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/node.exe');
    h.service.ensure('tmr-doorlock', '/target/tmr/index.js', '/rt/node.exe');

    expect(h.events.filter((e) => e.event === 'stderr')).toHaveLength(0);
  });

  test('호스트 런타임끼리의 재요청도 조용하다', () => {
    // 둘 다 undefined — 여기서 알리면 평범한 멱등 재요청마다 잡음이 난다.
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/e.js');
    h.service.ensure('cash-dispenser', '/e.js');

    expect(h.events.filter((e) => e.event === 'stderr')).toHaveLength(0);
  });

  test('이미 살아있으면 다시 띄우지 않고 포트만 새로 준다', () => {
    const h = createHarness();
    const first = h.service.ensure('cash-dispenser', '/e.js');
    const second = h.service.ensure('cash-dispenser', '/e.js');

    // 백엔드가 respawn 되어 다시 물어도 자식은 하나뿐이어야 한다.
    expect(h.forked).toHaveLength(1);
    expect(second).not.toBe(first);
    expect(h.channels).toHaveLength(2);
  });

  test('포트를 새로 발급할 때 옛 중계는 닫는다', () => {
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/e.js');
    h.service.ensure('cash-dispenser', '/e.js');

    // 죽은 백엔드로 흘려보내지 않도록 이전 중계를 정리한다.
    expect(h.channels[0]?.port2.closed).toBe(true);
    expect(h.channels[1]?.port2.closed).toBe(false);
  });

  test('자식이 죽으면 다음 요청에 다시 띄운다', () => {
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/e.js');
    h.children[0]?.exit(1);
    h.service.ensure('cash-dispenser', '/e.js');

    expect(h.forked).toHaveLength(2);
  });

  test('메시지를 양방향으로 모양 변경 없이 중계한다', () => {
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/e.js');
    const { port2 } = h.channels[0] ?? {};
    const child = h.children[0];

    // 백엔드 → 자식
    port2?.emit({ id: 'r1', event: '/get_status', body: null });
    expect(child?.sent).toEqual([
      { id: 'r1', event: '/get_status', body: null },
    ]);

    // 자식 → 백엔드
    child?.emit({ id: 'r1', ok: true, code: 200, result: { x: 1 } });
    expect(port2?.sent).toEqual([
      { id: 'r1', ok: true, code: 200, result: { x: 1 } },
    ]);
  });

  test('생명주기를 통지한다', () => {
    const h = createHarness();
    h.service.ensure('suprema', '/e.js');
    h.children[0]?.exit(0);

    expect(h.events).toEqual([{ process: 'suprema', event: 'exit', code: 0 }]);
  });

  test('kill 하면 중계를 닫고 목록에서 지운다', () => {
    const h = createHarness();
    h.service.ensure('ime', '/e.js');
    h.service.kill('ime');

    expect(h.children[0]?.killed).toBe(true);
    expect(h.channels[0]?.port2.closed).toBe(true);

    h.service.ensure('ime', '/e.js');
    expect(h.forked).toHaveLength(2); // 지워졌으니 새로 뜬다
  });
});

/**
 * 재배선 박제.
 *
 * 백엔드는 업데이트·크래시로 여러 번 갈린다. 그때마다 포트를 새로 발급하는데, 자식에게
 * 거는 리스너까지 매번 새로 달면 **같은 응답이 갈린 횟수만큼 중복 전달**된다. 하드웨어
 * 응답이 두 번 오면 in-flight 계수와 FSM 이 어긋나므로 여기서 고정한다.
 */
describe('재배선', () => {
  test('여러 번 갈아끼워도 자식 응답이 중복 전달되지 않는다', () => {
    const h = createHarness();
    h.service.ensure('cash-dispenser', '/e.js');
    h.service.ensure('cash-dispenser', '/e.js'); // 백엔드 respawn 1
    h.service.ensure('cash-dispenser', '/e.js'); // 백엔드 respawn 2

    const latest = h.channels.at(-1);
    h.children[0]?.emit({ id: 'r1', ok: true, code: 200 });

    // 최신 포트로 정확히 한 번만 가야 한다.
    expect(latest?.port2.sent).toEqual([{ id: 'r1', ok: true, code: 200 }]);
  });

  test('옛 포트로는 더 이상 보내지 않는다', () => {
    const h = createHarness();
    h.service.ensure('ime', '/e.js');
    h.service.ensure('ime', '/e.js');

    h.children[0]?.emit({ id: 'r2', ok: true, code: 200 });

    expect(h.channels[0]?.port2.sent).toHaveLength(0);
    expect(h.channels[1]?.port2.sent).toHaveLength(1);
  });
});
