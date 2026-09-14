import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ON_DEP_FAIL, OUTBOX_STATUS } from 'kiosk-types';
import { MockExecutor, MockTimer } from '../../__test-utils__/mocks';
import { createTestDb, FakeClock } from '../../__test-utils__/test-db';
import type { Db } from '../../db';
import { outboxMutation } from '../../db';
import { OutboxService } from '../../service/OutboxService';
import { OutboxScheduler } from '../OutboxScheduler';

// ── setup ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

type Setup = {
  db: Db;
  clock: FakeClock;
  service: OutboxService;
  executor: MockExecutor;
  timer: MockTimer;
  scheduler: OutboxScheduler;
  cleanup: () => void;
};

function setupScheduler(
  opts: { intervalMs?: number; concurrency?: number } = {},
): Setup {
  const { db, cleanup } = createTestDb();
  const clock = new FakeClock(FIXED_NOW);
  const service = new OutboxService({
    db,
    clock: clock.now,
    random: () => 0.5, // deterministic backoff
  });
  const executor = new MockExecutor();
  const timer = new MockTimer();
  const scheduler = new OutboxScheduler({
    service,
    executor,
    timer,
    intervalMs: opts.intervalMs ?? 10_000,
    concurrency: opts.concurrency ?? 4,
  });
  return { db, clock, service, executor, timer, scheduler, cleanup };
}

function seedReadyRow(db: Db, id: string, attempts = 0): void {
  db.insert(outboxMutation)
    .values({
      id,
      type: 'someType',
      payload: {},
      status: OUTBOX_STATUS.PENDING,
      rootId: id,
      onDepFail: ON_DEP_FAIL.CANCEL,
      pendingDepsCount: 0,
      attempts,
      lastError: null,
      nextAttemptAt: FIXED_NOW,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      expiresAt: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .run();
}

/**
 * drainNow 는 실행을 배경으로 보내므로, 행 상태를 보려면 그 배치가 끝나야 한다.
 * 마이크로태스크 우연에 기대지 않도록 매크로태스크 한 턴을 명시적으로 넘긴다.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));

function getRow(db: Db, id: string) {
  return db
    .select()
    .from(outboxMutation)
    .where(eq(outboxMutation.id, id))
    .get();
}

let setup: Setup;
beforeEach(() => {
  setup = setupScheduler();
});
afterEach(() => {
  setup.cleanup();
});

// ── 테스트 본체 ────────────────────────────────────────────────────────

describe('OutboxScheduler.drainNow — verdict dispatch', () => {
  // ── 1. verdict 분기 ─────────────────────────────────────────────

  test("'success' verdict → service.markSuccess → 행 SUCCESS 전이", async () => {
    const { scheduler, executor, db } = setup;
    seedReadyRow(db, 'a');
    executor.setVerdict('a', { kind: 'success' });

    await scheduler.drainNow();

    await settle();

    expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUCCESS);
  });

  test("'transient_failure' verdict → service.markFailure → 행 PENDING + lastError", async () => {
    const { scheduler, executor, db } = setup;
    seedReadyRow(db, 'a');
    executor.setVerdict('a', {
      kind: 'transient_failure',
      error: 'network timeout',
    });

    await scheduler.drainNow();

    await settle();

    const row = getRow(db, 'a');
    expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(row?.lastError).toBe('network timeout');
    expect(row?.attempts).toBe(1);
  });

  test("'permanent_failure' verdict → service.markDead → 행 DEAD + lastError", async () => {
    const { scheduler, executor, db } = setup;
    seedReadyRow(db, 'a');
    executor.setVerdict('a', {
      kind: 'permanent_failure',
      error: '400 INVALID',
    });

    await scheduler.drainNow();

    await settle();

    const row = getRow(db, 'a');
    expect(row?.status).toBe(OUTBOX_STATUS.DEAD);
    expect(row?.lastError).toBe('400 INVALID');
  });

  test('executor 가 throw → markFailure (transient 처리, 재시도 가능)', async () => {
    const { scheduler, executor, db } = setup;
    seedReadyRow(db, 'a');
    executor.setVerdict('a', { kind: 'throw', error: 'boom' });

    await scheduler.drainNow();

    await settle();

    const row = getRow(db, 'a');
    expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    // 메시지에 원본 에러가 포함되어야 함 (정확한 포맷은 impl 자유)
    expect(row?.lastError).toContain('boom');
  });
  test("'deferred' verdict → service.markDeferred → PENDING + attempts 보존", async () => {
    const { scheduler, executor, db } = setup;
    seedReadyRow(db, 'a', 3);
    executor.setVerdict('a', { kind: 'deferred', reason: 'offline' });

    await scheduler.drainNow();

    await settle();

    const row = getRow(db, 'a');
    expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(row?.attempts).toBe(3); // 묻지 못한 것은 시도가 아니다
    expect(row?.lastError).toBeNull(); // defer 사유로 덮지 않는다
  });

  test('오프라인이 길어져도 DEAD 로 가지 않는다 — outbox 의 존재 이유', async () => {
    const { scheduler, executor, db, clock } = setup;
    seedReadyRow(db, 'a', 14); // 시도가 이미 많이 쌓인 행
    executor.setDefault({ kind: 'deferred', reason: 'ECONNREFUSED' });

    // 회선이 세 시간 끊긴 상황 — deferred 간격으로 계속 두드린다
    for (let i = 0; i < 50; i++) {
      await scheduler.drainNow();
      await settle();
      clock.advance(60_000);
    }

    const row = getRow(db, 'a');
    expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(row?.attempts).toBe(14);
  });

  test('executor 미주입 → deferred 로 흘러 큐가 소진되지 않는다', async () => {
    const { db, clock } = setup;
    const service = new OutboxService({ db, clock: clock.now });
    // executor 를 주지 않으면 UnconfiguredExecutor 가 쓰인다
    const scheduler = new OutboxScheduler({ service });
    seedReadyRow(db, 'a', 14);

    await scheduler.drainNow();

    await settle();

    const row = getRow(db, 'a');
    expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(row?.attempts).toBe(14);
  });

  test('디스패치 단계의 버그는 삼켜지지 않는다 — transient 로 둔갑하면 시도를 까먹는다', async () => {
    const { db, clock, executor } = setup;
    const service = new OutboxService({ db, clock: clock.now });
    service.markSuccess = async () => {
      throw new Error('dispatch bug');
    };
    const scheduler = new OutboxScheduler({ service, executor });
    seedReadyRow(db, 'a', 3);
    executor.setVerdict('a', { kind: 'success' });

    await scheduler.drainNow();

    await settle();
    await settle();

    // 관측점은 행이다 — 배경 실행이라 예외는 스케줄러 로그로 가지만, 우리 버그가
    // markFailure 로 새면 여기서 attempts 가 늘고 IN_FLIGHT 가 풀린다.
    const row = getRow(db, 'a');
    expect(row?.attempts).toBe(3);
    expect(row?.status).toBe(OUTBOX_STATUS.IN_FLIGHT);
    expect(row?.lastError).toBeNull();
  });
});

describe('OutboxScheduler.drainNow — 픽업 / 반환값', () => {
  test('ready 행 없음 → drainNow 0 반환', async () => {
    const { scheduler } = setup;

    const count = await scheduler.drainNow();

    await settle();

    expect(count).toBe(0);
  });

  test('ready 행 N 개 → 모두 처리, 반환값 = N', async () => {
    const { scheduler, executor, db } = setup;
    for (const id of ['a', 'b', 'c']) {
      seedReadyRow(db, id);
      executor.setVerdict(id, { kind: 'success' });
    }

    const count = await scheduler.drainNow();

    await settle();

    expect(count).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      expect(getRow(db, id)?.status).toBe(OUTBOX_STATUS.SUCCESS);
    }
  });

  test('concurrency 한도 적용 — 한 번에 그 한도까지만 픽업', async () => {
    const setup2 = setupScheduler({ concurrency: 2 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      seedReadyRow(setup2.db, id);
      setup2.executor.setVerdict(id, { kind: 'success' });
    }

    const count = await setup2.scheduler.drainNow();

    await settle();

    expect(count).toBe(2);
    // 나머지 3개는 PENDING 상태로 남아있어야 함
    const allRows = setup2.db.select().from(outboxMutation).all();
    const pendingCount = allRows.filter(
      (r) => r.status === OUTBOX_STATUS.PENDING,
    ).length;
    expect(pendingCount).toBe(3);
    setup2.cleanup();
  });

  test('여러 verdict 혼합 — 각자 알맞은 mark* 로 dispatch', async () => {
    const { scheduler, executor, db } = setup;
    seedReadyRow(db, 'ok');
    seedReadyRow(db, 'transient');
    seedReadyRow(db, 'perm');

    executor.setVerdict('ok', { kind: 'success' });
    executor.setVerdict('transient', {
      kind: 'transient_failure',
      error: 'try later',
    });
    executor.setVerdict('perm', {
      kind: 'permanent_failure',
      error: 'no way',
    });

    await scheduler.drainNow();

    await settle();

    expect(getRow(db, 'ok')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    expect(getRow(db, 'transient')?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(getRow(db, 'perm')?.status).toBe(OUTBOX_STATUS.DEAD);
  });
});

describe('OutboxScheduler.start / stop 라이프사이클', () => {
  test('start() 가 resetInFlight 를 한 번 수행 (부팅 복구)', async () => {
    const { scheduler, db } = setup;
    // IN_FLIGHT 로 멈춰있는 행 시뮬레이션
    db.insert(outboxMutation)
      .values({
        id: 'stuck',
        type: 'someType',
        payload: {},
        status: OUTBOX_STATUS.IN_FLIGHT,
        rootId: 'stuck',
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 0,
        attempts: 0,
        nextAttemptAt: FIXED_NOW,
        initialBackoffMs: 1_000,
        maxBackoffMs: 10_000,
        expiresAt: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
      .run();

    await scheduler.start();

    // start 호출 후 IN_FLIGHT 가 PENDING 으로 리셋됨
    expect(getRow(db, 'stuck')?.status).toBe(OUTBOX_STATUS.PENDING);

    scheduler.stop();
  });

  test('start() 가 첫 tick 을 timer 로 예약 (intervalMs 만큼)', async () => {
    const { scheduler, timer } = setup;

    await scheduler.start();

    expect(timer.pendingCount()).toBe(1);
    expect(timer.lastDelayMs()).toBe(10_000);

    scheduler.stop();
  });

  test('start() 두 번 호출하면 두 번째는 no-op', async () => {
    const { scheduler, timer } = setup;

    await scheduler.start();
    await scheduler.start();

    // 타이머 1개만 등록되어야 함 (중복 스케줄링 안 됨)
    expect(timer.pendingCount()).toBe(1);

    scheduler.stop();
  });

  test('stop() 이 보류된 timer 를 취소', async () => {
    const { scheduler, timer } = setup;

    await scheduler.start();
    expect(timer.pendingCount()).toBe(1);

    scheduler.stop();
    expect(timer.pendingCount()).toBe(0);
  });

  test('stop() 을 start 없이 호출해도 throw 없음', () => {
    const { scheduler } = setup;
    expect(() => scheduler.stop()).not.toThrow();
  });
});

describe('OutboxScheduler.start — 자기 재호출 루프', () => {
  test('tick 완료 후 다음 tick 이 새 timer 로 예약됨', async () => {
    const { scheduler, executor, timer, db } = setup;
    seedReadyRow(db, 'a');
    executor.setVerdict('a', { kind: 'success' });

    await scheduler.start();
    expect(timer.pendingCount()).toBe(1);

    // 첫 tick 발화
    await timer.runNext();

    // 'a' 처리됐고 다음 tick 이 새로 예약됐어야 함
    expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    expect(timer.pendingCount()).toBe(1);

    scheduler.stop();
    expect(timer.pendingCount()).toBe(0);
  });

  test('stop 이후엔 tick 발화해도 다음 tick 안 예약', async () => {
    const { scheduler, executor, timer, db } = setup;
    seedReadyRow(db, 'a');
    executor.setVerdict('a', { kind: 'success' });

    await scheduler.start();
    scheduler.stop();
    expect(timer.pendingCount()).toBe(0);

    // 이미 cancel 된 후라 발화할 게 없음
    await timer.runNext();

    expect(timer.pendingCount()).toBe(0);
  });
});
