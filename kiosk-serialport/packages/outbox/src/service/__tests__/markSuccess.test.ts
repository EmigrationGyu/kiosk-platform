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
  type?: string;
  rootId?: string;
  pendingDepsCount?: number;
  nextAttemptAt?: number | null;
  attempts?: number;
  lastError?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: opts.type ?? 'someType',
      payload: {},
      status: opts.status ?? OUTBOX_STATUS.IN_FLIGHT,
      rootId: opts.rootId ?? opts.id,
      onDepFail: ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      nextAttemptAt: opts.nextAttemptAt ?? FIXED_NOW,
      createdAt: opts.createdAt ?? FIXED_NOW,
      updatedAt: opts.updatedAt ?? FIXED_NOW,
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

describe('OutboxService.markSuccess', () => {
  // ── 1. 기본 전이 ────────────────────────────────────────────────────

  describe('기본 전이 (IN_FLIGHT → SUCCESS)', () => {
    test('status 가 IN_FLIGHT 에서 SUCCESS 로 전이', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      await service.markSuccess('a');

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    });

    test('updatedAt 은 clock.now() 로 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });
      clock.set(FIXED_NOW + 7000);

      await service.markSuccess('a');

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 7000);
    });

    test('createdAt / attempts 는 변경되지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.IN_FLIGHT,
        createdAt: 100,
        attempts: 3,
      });

      await service.markSuccess('a');

      const row = getRow(db, 'a');
      expect(row?.createdAt).toBe(100);
      expect(row?.attempts).toBe(3);
    });

    test('성공 시 lastError 는 null 로 클리어 (이전 transient 실패 자취 정리)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.IN_FLIGHT,
        lastError: 'previous transient error',
      });

      await service.markSuccess('a');

      expect(getRow(db, 'a')?.lastError).toBeNull();
    });
  });

  // ── 2. 자식 pendingDepsCount 감소 ──────────────────────────────────

  describe('자식 pendingDepsCount 감소', () => {
    test('자식 1개, deps=1 → deps=0 (즉시 ready)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markSuccess('p');

      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    });

    test('자식 N 개, 각 deps=1 → 모두 0 으로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      for (const c of ['c1', 'c2', 'c3']) {
        seedRow(db, {
          id: c,
          status: OUTBOX_STATUS.PENDING,
          pendingDepsCount: 1,
        });
        seedDep(db, 'p', c);
      }

      await service.markSuccess('p');

      for (const c of ['c1', 'c2', 'c3']) {
        expect(getRow(db, c)?.pendingDepsCount).toBe(0);
      }
    });

    test('자식이 다른 부모도 의존 (deps=2) → 1 로만 감소 (다른 부모 만큼 남음)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 2,
      });
      seedDep(db, 'p1', 'c');
      seedDep(db, 'p2', 'c');

      await service.markSuccess('p1');

      // p2 가 아직 안 끝났으니 c 의 카운트는 1 로만 감소
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
      // p2 자체는 영향 없음
      expect(getRow(db, 'p2')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('자식 없으면 다른 행에 영향 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'unrelated',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 5,
      });

      await service.markSuccess('p');

      expect(getRow(db, 'unrelated')?.pendingDepsCount).toBe(5);
    });
  });

  // ── 3. 손자 / 무관한 행 영향 없음 ──────────────────────────────────

  describe('손자(grandchild) / 무관한 행 영향 없음', () => {
    test('손자 카운터는 변하지 않음 (직접 자식만 영향)', async () => {
      const { service, db } = setup;
      // p → c → g  체인
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.markSuccess('p');

      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
      // g 의 부모 c 는 아직 SUCCESS 아니므로 g 카운트는 그대로
      expect(getRow(db, 'g')?.pendingDepsCount).toBe(1);
    });

    test('무관한 다른 노드의 status 변화 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'unrelated',
        status: OUTBOX_STATUS.PENDING,
      });

      await service.markSuccess('p');

      expect(getRow(db, 'unrelated')?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 4. 멱등성 ───────────────────────────────────────────────────────

  describe('멱등성', () => {
    test('이미 SUCCESS 인 행에 재호출 → 자식 카운터 변동 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.SUCCESS });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markSuccess('p');

      // 이미 SUCCESS 인 부모 재마킹은 자식 영향 없어야 함
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
    });

    test('IN_FLIGHT 가 아닌 행(PENDING) 에 호출 → 변화 없음 (no-op)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.PENDING });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markSuccess('p');

      // p 는 SUCCESS 로 전이되지 않음, 자식 카운터도 그대로
      expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
    });
  });

  // ── 5. 트랜잭션 일관성 ────────────────────────────────────────────

  describe('원자성', () => {
    test('부모 SUCCESS 마킹과 자식 카운터 감소가 한 트랜잭션', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markSuccess('p');

      // 둘 다 끝난 상태로 관찰
      expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.SUCCESS);
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    });
  });

  // ── 6. 자식 자체가 종결 상태일 때 ─────────────────────────────────

  describe('자식이 종결 상태인 엣지', () => {
    test('자식이 이미 CANCELLED 여도 카운터는 그대로 감소 (구조적 일관성)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markSuccess('p');

      // 자식 status 는 CANCELLED 그대로 (markSuccess 가 자식 status 를 건드리지 않음)
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      // 카운터는 일관성 위해 감소 — 추후 resolve(REACTIVATE) 시 정확한 값에서 시작
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    });
  });
});
