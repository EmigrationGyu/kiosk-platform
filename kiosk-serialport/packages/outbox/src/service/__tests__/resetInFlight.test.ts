import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ON_DEP_FAIL, OUTBOX_STATUS, type OutboxStatus } from 'kiosk-types';
import { createTestDb, FakeClock } from '../../__test-utils__/test-db';
import type { Db } from '../../db';
import { outboxDependency, outboxMutation } from '../../db';
import { OutboxService } from '../OutboxService';

// ── setup ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

type Setup = {
  db: Db;
  clock: FakeClock;
  service: OutboxService;
  cleanup: () => void;
};

function setupService(): Setup {
  const { db, cleanup } = createTestDb();
  const clock = new FakeClock(FIXED_NOW);
  const service = new OutboxService({ db, clock: clock.now });
  return { db, clock, service, cleanup };
}

type SeedOpts = {
  id: string;
  status?: OutboxStatus;
  attempts?: number;
  lastError?: string | null;
  pendingDepsCount?: number;
  nextAttemptAt?: number | null;
  createdAt?: number;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: 'someType',
      payload: {},
      status: opts.status ?? OUTBOX_STATUS.IN_FLIGHT,
      rootId: opts.id,
      onDepFail: ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      nextAttemptAt: opts.nextAttemptAt ?? FIXED_NOW,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      expiresAt: null,
      createdAt: opts.createdAt ?? FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .run();
}

function seedDep(db: Db, parentId: string, childId: string): void {
  db.insert(outboxDependency).values({ parentId, childId }).run();
}

function getRow(db: Db, id: string) {
  return db
    .select()
    .from(outboxMutation)
    .where(eq(outboxMutation.id, id))
    .get();
}

let setup: Setup;
beforeEach(() => {
  setup = setupService();
});
afterEach(() => {
  setup.cleanup();
});

// ── 테스트 본체 ────────────────────────────────────────────────────────

describe('OutboxService.resetInFlight', () => {
  // ── 1. 기본 동작 ────────────────────────────────────────────────────

  describe('기본 동작', () => {
    test('IN_FLIGHT 단일 행 → PENDING 으로 리셋', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      await service.resetInFlight();

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('IN_FLIGHT 다수 행 → 모두 PENDING 으로', async () => {
      const { service, db } = setup;
      for (const id of ['a', 'b', 'c']) {
        seedRow(db, { id, status: OUTBOX_STATUS.IN_FLIGHT });
      }

      await service.resetInFlight();

      for (const id of ['a', 'b', 'c']) {
        expect(getRow(db, id)?.status).toBe(OUTBOX_STATUS.PENDING);
      }
    });

    test('반환값 = 리셋된 행 개수', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, { id: 'b', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, { id: 'c', status: OUTBOX_STATUS.PENDING }); // 영향 없음

      const count = await service.resetInFlight();

      expect(count).toBe(2);
    });
  });

  // ── 2. 다른 상태 보존 ─────────────────────────────────────────────

  describe('IN_FLIGHT 외 상태는 건드리지 않음', () => {
    test('PENDING / SUCCESS / DEAD / CANCELLED / RESOLVED_EXTERNAL 모두 그대로', async () => {
      const { service, db } = setup;
      const states: { id: string; status: OutboxStatus }[] = [
        { id: 'pending', status: OUTBOX_STATUS.PENDING },
        { id: 'success', status: OUTBOX_STATUS.SUCCESS },
        { id: 'dead', status: OUTBOX_STATUS.DEAD },
        { id: 'cancelled', status: OUTBOX_STATUS.CANCELLED },
        { id: 'resolved', status: OUTBOX_STATUS.RESOLVED_EXTERNAL },
      ];
      for (const s of states) seedRow(db, s);

      const count = await service.resetInFlight();

      expect(count).toBe(0);
      for (const s of states) {
        expect(getRow(db, s.id)?.status).toBe(s.status);
      }
    });
  });

  // ── 3. 타임스탬프 ────────────────────────────────────────────────

  describe('타임스탬프', () => {
    test('nextAttemptAt = clock.now() — 즉시 ready', async () => {
      const { service, clock, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.IN_FLIGHT,
        nextAttemptAt: FIXED_NOW + 999_999, // 미래에 박혀있던 값
      });
      clock.set(FIXED_NOW + 5_000);

      await service.resetInFlight();

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + 5_000);
    });

    test('updatedAt 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });
      clock.set(FIXED_NOW + 7_000);

      await service.resetInFlight();

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 7_000);
    });
  });

  // ── 4. 보존되는 필드 ─────────────────────────────────────────────

  describe('필드 보존', () => {
    test('attempts / lastError / createdAt 그대로 (클린 리셋이지 시도 결과 아님)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.IN_FLIGHT,
        attempts: 3,
        lastError: 'previous transient',
        createdAt: 100,
      });

      await service.resetInFlight();

      const row = getRow(db, 'a');
      expect(row?.attempts).toBe(3);
      expect(row?.lastError).toBe('previous transient');
      expect(row?.createdAt).toBe(100);
    });
  });

  // ── 5. 빈 케이스 ─────────────────────────────────────────────────

  describe('IN_FLIGHT 없는 경우', () => {
    test('빈 DB → 0 반환, throw 없음', async () => {
      const { service } = setup;

      const count = await service.resetInFlight();

      expect(count).toBe(0);
    });

    test('IN_FLIGHT 없고 다른 상태만 있을 때 → 0 반환', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'b', status: OUTBOX_STATUS.SUCCESS });

      const count = await service.resetInFlight();

      expect(count).toBe(0);
    });
  });

  // ── 6. 자식 / 의존성 영향 없음 ─────────────────────────────────

  describe('자식 / 의존성 영향 없음', () => {
    test('자식 카운터 / 의존성 row 안 건드림', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resetInFlight();

      // p 자체만 PENDING 으로
      expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.PENDING);
      // c 는 그대로
      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(c?.pendingDepsCount).toBe(1);
      // dependency row 도 그대로
      const deps = db.select().from(outboxDependency).all();
      expect(deps).toHaveLength(1);
    });
  });
});
