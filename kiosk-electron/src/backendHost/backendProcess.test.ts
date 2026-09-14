import { describe, expect, test } from 'bun:test';
import { type BackendChildLike, createBackendProcess } from './backendProcess';

type FakeChild = BackendChildLike & {
  sent: { message: unknown; transfer?: unknown[] }[];
  spawn: () => void;
  exit: (code: number | null) => void;
  killed: boolean;
};

function makeFork() {
  const children: FakeChild[] = [];
  const fork = (): BackendChildLike => {
    let onSpawn: (() => void) | null = null;
    let onExit: ((code: number | null) => void) | null = null;
    const child: FakeChild = {
      sent: [],
      killed: false,
      postMessage: (message, transfer) =>
        child.sent.push({ message, transfer }),
      onMessage: () => undefined,
      onSpawn: (listener) => {
        onSpawn = listener;
      },
      onExit: (listener) => {
        onExit = listener;
      },
      onStdout: () => undefined,
      onStderr: () => undefined,
      kill: () => {
        child.killed = true;
      },
      spawn: () => onSpawn?.(),
      exit: (code) => onExit?.(code),
    };
    children.push(child);
    return child;
  };
  return { fork, children };
}

describe('기동 통지 시점', () => {
  test('fork 직후가 아니라 자식이 뜬 뒤에 알린다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork });
    const started: number[] = [];
    backend.onStarted(() => started.push(1));

    backend.start();
    // fork 는 됐지만 아직 자식이 뜨지 않았다 — 이 시점에 배선하면 포트가 사라진다.
    expect(started).toHaveLength(0);

    children[0].spawn();
    expect(started).toHaveLength(1);
  });

  test('재기동해도 매번 알린다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork });
    let started = 0;
    backend.onStarted(() => {
      started += 1;
    });

    backend.start();
    children[0].spawn();
    backend.restart();
    children[1].spawn();

    expect(started).toBe(2);
  });
});

describe('spawn 이전 송신', () => {
  test('담아뒀다가 자식이 뜬 뒤 흘려보낸다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork });

    backend.start();
    const port = { tag: 'renderer-port' };
    backend.send({ kind: 'port' }, [port]);

    // 아직 상대가 없다 — 지금 보내면 조용히 사라진다.
    expect(children[0].sent).toHaveLength(0);

    children[0].spawn();
    expect(children[0].sent).toEqual([
      { message: { kind: 'port' }, transfer: [port] },
    ]);
  });

  test('뜬 뒤에는 곧바로 보낸다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork });

    backend.start();
    children[0].spawn();
    backend.send({ kind: 'event' });

    expect(children[0].sent).toEqual([
      { message: { kind: 'event' }, transfer: undefined },
    ]);
  });

  test('재기동하면 옛 세대의 대기분은 새 자식으로 넘어가지 않는다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork });

    backend.start();
    backend.send({ kind: 'port', generation: 1 });
    backend.restart();
    children[1].spawn();

    // 옛 세대로 향하던 메시지가 새 자식에게 배달되면 죽은 포트를 쥐여주는 셈이 된다.
    expect(children[1].sent).toHaveLength(0);
  });
});

describe('세대 판정', () => {
  test('교체된 옛 자식의 exit 는 자동 재기동을 태우지 않는다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork, autoRestart: true });

    backend.start();
    children[0].spawn();
    backend.restart();
    // kill 한 옛 자식의 exit 가 뒤늦게 도착한다.
    children[0].exit(0);

    expect(children).toHaveLength(2);
  });

  test('교체된 옛 자식의 spawn 은 배선을 부르지 않는다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork });
    let started = 0;
    backend.onStarted(() => {
      started += 1;
    });

    backend.start();
    backend.restart();
    // 늦게 도착한 옛 세대의 spawn.
    children[0].spawn();

    expect(started).toBe(0);
  });

  test('kill 뒤에는 자동 재기동하지 않는다', () => {
    const { fork, children } = makeFork();
    const backend = createBackendProcess({ fork, autoRestart: true });

    backend.start();
    children[0].spawn();
    backend.kill();
    children[0].exit(0);

    expect(children).toHaveLength(1);
  });
});
