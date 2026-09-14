import { beforeEach, describe, expect, test } from 'bun:test';
import {
  encodeLogLine,
  type LogRecord,
  SERIALPORT_PROCESS,
  type SerialportProcess,
} from 'kiosk-types';
import { createProcessManager } from './createProcessManager';
import {
  IDLE_SHUTDOWN_MS,
  isLazy,
  isPersistent,
  MANAGED_PROCESSES,
} from './policy';
import type { ProcessHandle, Spawner } from './types';

/**
 * 서브프로세스 수명 결정 로직 박제.
 *
 * 하드웨어 영역이라 "언제 띄우고 언제 거두는가"를 촘촘히 고정한다. 특히 in-flight 보호는
 * 장시간 대기 요청(카드결제)이 걸린 프로세스를 reaper 가 내려 거래를 죽이는 사고와
 * 직결되고, 종료 분류는 정상 종료가 크래시로 오인돼 로그가 오염되는 문제와 직결된다.
 */

type FakeChild = ProcessHandle<null> & {
  killCount: number;
  exit(code: number | null): void;
  emitStdout(text: string): void;
  emitStderr(text: string): void;
};

function createFakeSpawner() {
  const spawned: { process: SerialportProcess; child: FakeChild }[] = [];

  const spawner: Spawner<null> = {
    spawn(process) {
      let onExit: ((code: number | null) => void) | null = null;
      let onStdout: ((text: string) => void) | null = null;
      let onStderr: ((text: string) => void) | null = null;
      const child: FakeChild = {
        killCount: 0,
        channel: null,
        ready: Promise.resolve(),
        onExit: (cb: (code: number | null) => void) => {
          onExit = cb;
        },
        onStdout: (cb: (text: string) => void) => {
          onStdout = cb;
        },
        onStderr: (cb: (text: string) => void) => {
          onStderr = cb;
        },
        kill: () => {
          child.killCount += 1;
          onExit?.(0); // 실제 utilityProcess 도 kill 후 exit 를 낸다
        },
        exit: (code: number | null) => onExit?.(code),
        emitStdout: (text: string) => onStdout?.(text),
        emitStderr: (text: string) => onStderr?.(text),
      };
      spawned.push({ process, child });
      return child;
    },
  };

  return { spawner, spawned };
}

const DEVICE = SERIALPORT_PROCESS.TOKEN_DISPENSER;
const OTHER = SERIALPORT_PROCESS.IME;

describe('createProcessManager', () => {
  let clock = 0;
  let fake: ReturnType<typeof createFakeSpawner>;
  let logs: LogRecord[];

  const build = () => {
    fake = createFakeSpawner();
    logs = [];
    return createProcessManager({
      spawner: fake.spawner,
      now: () => clock,
      onLog: (record) => logs.push(record),
    });
  };

  beforeEach(() => {
    clock = 0;
  });

  test('생성만으로는 아무것도 띄우지 않는다 (전부 lazy)', () => {
    build();
    expect(fake.spawned).toHaveLength(0);
  });

  test('startEager 는 lazy 가 아닌 프로세스만 띄운다', () => {
    const manager = build();
    manager.startEager();
    const eager = MANAGED_PROCESSES.filter((p) => !isLazy(p));
    expect(fake.spawned.map((s) => s.process)).toEqual([...eager]);
  });

  test('ensure 는 첫 호출에만 띄우고 이후엔 같은 핸들을 준다', () => {
    const manager = build();
    const first = manager.ensure(DEVICE);
    const second = manager.ensure(DEVICE);
    expect(fake.spawned).toHaveLength(1);
    expect(fake.spawned[0]?.process).toBe(DEVICE);
    expect(second).toBe(first);
  });

  test('크래시로 죽으면 자동 재시작하지 않고, 다음 요청 때 다시 띄운다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    fake.spawned[0]?.child.exit(1);
    expect(fake.spawned).toHaveLength(1); // 자동 재시작 없음 (이중 spawn 방지)

    manager.ensure(DEVICE);
    expect(fake.spawned).toHaveLength(2);
  });

  test('크래시일 때만 에러 로그를 남긴다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    fake.spawned[0]?.child.exit(1);
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(1);
  });

  test('idle 초과 프로세스를 회수하고, 그 종료는 크래시로 분류하지 않는다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    manager.markRequestStart(DEVICE);
    manager.markRequestEnd(DEVICE, 'answered');

    clock += IDLE_SHUTDOWN_MS + 1;
    expect(manager.reapIdle(clock)).toEqual([DEVICE]);
    expect(fake.spawned[0]?.child.killCount).toBe(1);
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  test('in-flight 가 남아 있으면 아무리 오래돼도 회수하지 않는다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    manager.markRequestStart(DEVICE); // 응답 대기 중 (예: 카드결제)

    clock += IDLE_SHUTDOWN_MS * 10;
    expect(manager.reapIdle(clock)).toEqual([]);
    expect(fake.spawned[0]?.child.killCount).toBe(0);
  });

  test('markEnd 로 균형이 맞으면 그때부터 회수 대상이 된다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    manager.markRequestStart(DEVICE);
    manager.markRequestStart(DEVICE);
    manager.markRequestEnd(DEVICE, 'answered');

    clock += IDLE_SHUTDOWN_MS + 1;
    expect(manager.reapIdle(clock)).toEqual([]); // 아직 1건 남음

    manager.markRequestEnd(DEVICE, 'answered');
    clock += IDLE_SHUTDOWN_MS + 1;
    expect(manager.reapIdle(clock)).toEqual([DEVICE]);
  });

  test('안 물어본 프로세스는 승격 판정에서 무관하다', () => {
    const manager = build();

    expect(manager.allAnswered()).toBe(true);
  });

  test('물어봤는데 답이 없으면 승격하지 않는다 — 봉투가 안 온 것만 소프트웨어 문제다', () => {
    const manager = build();
    manager.markRequestStart(DEVICE);
    manager.markRequestEnd(DEVICE, 'unanswered');

    expect(manager.allAnswered()).toBe(false);
  });

  test('PERSISTENT 프로세스는 아무리 조용해도 회수하지 않는다', () => {
    // 정책을 주입해 분기를 직접 겨눈다 — 자기 타이머로 일하는 프로세스는 IPC 가 조용한
    // 것이 무활동이 아니라서, reaper 가 내리면 겉보기엔 멀쩡한 진행이 함께 멈춘다.
    fake = createFakeSpawner();
    logs = [];
    const manager = createProcessManager({
      spawner: fake.spawner,
      now: () => clock,
      onLog: (record) => logs.push(record),
      isPersistent: (p) => p === OTHER,
    });
    manager.ensure(OTHER);
    manager.markRequestStart(OTHER);
    manager.markRequestEnd(OTHER, 'answered');

    clock += IDLE_SHUTDOWN_MS * 100;
    expect(manager.reapIdle(clock)).toEqual([]);
    expect(fake.spawned[0]?.child.killCount).toBe(0);
  });

  // outbox 는 자기 타이머로 큐를 돌린다 — IPC 가 조용한 것이 무활동이 아니다.
  // 거두면 겉보기엔 멀쩡하던 전송이 함께 멈춘다.
  test('PERSISTENT 는 자기 타이머로 일하는 프로세스만 담는다', () => {
    expect(MANAGED_PROCESSES.filter(isPersistent)).toEqual([
      SERIALPORT_PROCESS.OUTBOX,
    ]);
  });

  // ── (재)기동 알림 ────────────────────────────────────────────────────

  /**
   * 자격증명처럼 **부모가 쥐고 자식 메모리에만 사는 상태**는 재기동을 따라가지 않는다.
   * 다시 밀어주지 않으면 자식은 계속 "아직 물어볼 수 없다"로 되돌려 보내고, 그건
   * 시도를 소모하지 않으므로 큐가 에러 없이 조용히 멈춘다(실측).
   */
  describe('onSpawned — 재기동한 자식에게 상태를 다시 밀 수 있게', () => {
    test('spawn 할 때마다 알린다', () => {
      const manager = build();
      const seen: SerialportProcess[] = [];
      manager.onSpawned((p) => seen.push(p));

      manager.ensure(DEVICE);
      manager.ensure(OTHER);

      expect(seen).toEqual([DEVICE, OTHER]);
    });

    test('이미 살아 있으면 알리지 않는다 — 새로 태어난 것만이 대상이다', () => {
      const manager = build();
      const seen: SerialportProcess[] = [];
      manager.onSpawned((p) => seen.push(p));

      manager.ensure(DEVICE);
      manager.ensure(DEVICE);

      expect(seen).toEqual([DEVICE]);
    });

    test('크래시 후 재spawn 도 알린다 — 이게 없으면 자격이 영영 안 돌아온다', () => {
      const manager = build();
      const seen: SerialportProcess[] = [];
      manager.onSpawned((p) => seen.push(p));

      manager.ensure(OTHER);
      fake.spawned[0]?.child.exit(1);
      manager.ensure(OTHER);

      expect(seen).toEqual([OTHER, OTHER]);
    });

    test('여러 구독자 모두에게 간다', () => {
      const manager = build();
      const a: string[] = [];
      const b: string[] = [];
      manager.onSpawned(() => a.push('a'));
      manager.onSpawned(() => b.push('b'));

      manager.ensure(OTHER);

      expect([a, b]).toEqual([['a'], ['b']]);
    });
  });

  test('회수 후 다음 요청에 다시 띄운다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    manager.markRequestStart(DEVICE);
    manager.markRequestEnd(DEVICE, 'answered');
    clock += IDLE_SHUTDOWN_MS + 1;
    manager.reapIdle(clock);

    manager.ensure(DEVICE);
    expect(fake.spawned).toHaveLength(2);
  });

  test('살아있는 프로세스 없는 활동 레코드는 kill 없이 정리한다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    manager.markRequestStart(DEVICE);
    manager.markRequestEnd(DEVICE, 'answered');
    fake.spawned[0]?.child.exit(1); // 크래시 — 레코드는 남는다

    clock += IDLE_SHUTDOWN_MS + 1;
    expect(manager.reapIdle(clock)).toEqual([]); // 죽은 프로세스를 kill 하지 않는다
    // 레코드가 정리됐으므로 두 번째 회수에서도 아무것도 안 나온다
    expect(manager.reapIdle(clock)).toEqual([]);
  });

  test('stopAll 은 전부 내리고, 그 종료를 크래시로 남기지 않는다', () => {
    const manager = build();
    manager.ensure(DEVICE);
    manager.ensure(OTHER);

    manager.stopAll();

    expect(fake.spawned.map((s) => s.child.killCount)).toEqual([1, 1]);
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  test('종료 중에는 새로 띄우지 않는다 (고아 프로세스 방지)', () => {
    const manager = build();
    manager.stopAll();
    expect(() => manager.ensure(DEVICE)).toThrow();
  });

  test('stderr 는 파일 로그로 미러링된다 (부팅 크래시 진단)', () => {
    const manager = build();
    manager.ensure(DEVICE);
    fake.spawned[0]?.child.emitStderr('koffi load failed');

    const mirrored = logs.find((l) => l.msg?.includes('koffi load failed'));
    expect(mirrored?.level).toBe('error');
    expect(mirrored?.origin).toBe(DEVICE);
  });

  /**
   * 자식은 자기 로그 파일을 열지 않고 stdout 으로 흘려보낸다 — 파일의 단독 소유자는
   * 백엔드다. 여기가 무너지면 서브프로세스 로그가 통째로 사라지므로 촘촘히 박제한다.
   */
  describe('자식 로그 릴레이', () => {
    const record: LogRecord = {
      origin: DEVICE,
      level: 'warn',
      time: '2026-08-28 10:11:12.130',
      msg: '카드 회수 지연',
    };

    test('프레이밍된 stdout 줄은 레코드 그대로 나간다', () => {
      const manager = build();
      manager.ensure(DEVICE);
      fake.spawned[0]?.child.emitStdout(encodeLogLine(record));

      expect(logs).toEqual([record]);
    });

    test('시각은 자식이 찍은 것을 유지한다 (도착 시각으로 덮지 않는다)', () => {
      const manager = build();
      manager.ensure(DEVICE);
      fake.spawned[0]?.child.emitStdout(encodeLogLine(record));

      expect(logs[0]?.time).toBe(record.time);
    });

    test('한 청크에 여러 줄이 실려와도 다 걷어낸다', () => {
      const manager = build();
      manager.ensure(DEVICE);
      const second = { ...record, msg: '두 번째' };
      fake.spawned[0]?.child.emitStdout(
        `${encodeLogLine(record)}
${encodeLogLine(second)}`,
      );

      expect(logs).toEqual([record, second]);
    });

    test('로그가 아닌 stdout 줄은 로그로 새지 않는다 ([ready] 등)', () => {
      const manager = build();
      manager.ensure(DEVICE);
      fake.spawned[0]?.child.emitStdout('[ready]');

      expect(logs).toHaveLength(0);
    });
  });
});
