import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ON_DEP_FAIL, OUTBOX_STATUS, type OutboxStatus } from 'kiosk-types';
import { createTestDb, FakeClock } from '../../__test-utils__/test-db';
import type { Db } from '../../db';
import { outboxMutation } from '../../db';
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
  createdAt?: number;
  updatedAt?: number;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: opts.type ?? 'someType',
      payload: {},
      status: opts.status ?? OUTBOX_STATUS.PENDING,
      rootId: opts.rootId ?? opts.id,
      onDepFail: ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      nextAttemptAt: opts.nextAttemptAt ?? FIXED_NOW,
      createdAt: opts.createdAt ?? FIXED_NOW,
      updatedAt: opts.updatedAt ?? FIXED_NOW,
    })
    .run();
}

let setup: Setup;
beforeEach(() => {
  setup = setupService();
});
afterEach(() => {
  setup.cleanup();
});

// ── 테스트 본체 ────────────────────────────────────────────────────────

describe('OutboxService.pickReady', () => {
  // ── 1. 기본 동작 ────────────────────────────────────────────────────

  describe('기본 동작', () => {
    test('큐가 비어있으면 빈 배열 반환', async () => {
      const { service } = setup;
      const picked = await service.pickReady(10);
      expect(picked).toEqual([]);
    });

    test('ready 한 PENDING 행 1개 → 1개 픽업', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      const picked = await service.pickReady(10);
      expect(picked).toHaveLength(1);
      expect(picked[0]?.id).toBe('a');
    });

    test('픽업된 행은 IN_FLIGHT 로 마크됨 (DB 반영)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      await service.pickReady(10);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'a'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.IN_FLIGHT);
    });

    test('반환된 행의 status 도 IN_FLIGHT (트랜잭션 일관성)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      const picked = await service.pickReady(10);
      expect(picked[0]?.status).toBe(OUTBOX_STATUS.IN_FLIGHT);
    });

    test('updatedAt 은 clock.now() 로 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'a' }); // 기본값: updatedAt = FIXED_NOW
      clock.set(FIXED_NOW + 5000); // 픽업 시점을 미래로

      await service.pickReady(10);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'a'))
        .get();
      expect(row?.updatedAt).toBe(FIXED_NOW + 5000);
    });
  });

  // ── 2. 변경되지 않아야 하는 필드 ──────────────────────────────────────

  describe('변경되지 않는 필드', () => {
    test('createdAt 은 픽업해도 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', createdAt: 100 });

      await service.pickReady(10);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'a'))
        .get();
      expect(row?.createdAt).toBe(100);
    });

    test('attempts 는 픽업해도 그대로 (실행 결과 단계에서 갱신)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 3 });

      await service.pickReady(10);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'a'))
        .get();
      expect(row?.attempts).toBe(3);
    });
  });

  // ── 3. status 필터 ─────────────────────────────────────────────────

  describe('status 필터', () => {
    test('IN_FLIGHT 행은 픽업 안 됨', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      const picked = await service.pickReady(10);
      expect(picked).toEqual([]);
    });

    test('SUCCESS / DEAD / CANCELLED / RESOLVED_EXTERNAL 모두 픽업 안 됨', async () => {
      const { service, db } = setup;
      const nonPicking: OutboxStatus[] = [
        OUTBOX_STATUS.SUCCESS,
        OUTBOX_STATUS.DEAD,
        OUTBOX_STATUS.CANCELLED,
        OUTBOX_STATUS.RESOLVED_EXTERNAL,
      ];
      nonPicking.forEach((s, i) => seedRow(db, { id: `s-${i}`, status: s }));

      const picked = await service.pickReady(10);
      expect(picked).toEqual([]);
    });

    test('PENDING 만 골라서 픽업 (다른 상태는 무시)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'i', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, { id: 's', status: OUTBOX_STATUS.SUCCESS });

      const picked = await service.pickReady(10);
      expect(picked.map((r) => r.id)).toEqual(['p']);
    });
  });

  // ── 4. 의존성 필터 ────────────────────────────────────────────────

  describe('의존성 필터 (pendingDepsCount)', () => {
    test('pendingDepsCount > 0 행은 픽업 안 됨', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', pendingDepsCount: 1 });

      const picked = await service.pickReady(10);
      expect(picked).toEqual([]);
    });

    test('pendingDepsCount = 0 행만 픽업', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'ready', pendingDepsCount: 0 });
      seedRow(db, { id: 'blocked-1', pendingDepsCount: 1 });
      seedRow(db, { id: 'blocked-3', pendingDepsCount: 3 });

      const picked = await service.pickReady(10);
      expect(picked.map((r) => r.id)).toEqual(['ready']);
    });
  });

  // ── 5. nextAttemptAt 필터 ────────────────────────────────────────

  describe('nextAttemptAt 필터 (백오프)', () => {
    test('nextAttemptAt > now() 행은 픽업 안 됨 (백오프 중)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', nextAttemptAt: FIXED_NOW + 1000 });

      const picked = await service.pickReady(10);
      expect(picked).toEqual([]);
    });

    test('nextAttemptAt = now() 행은 픽업됨 (경계 inclusive)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', nextAttemptAt: FIXED_NOW });

      const picked = await service.pickReady(10);
      expect(picked.map((r) => r.id)).toEqual(['a']);
    });

    test('nextAttemptAt < now() 행은 픽업됨 (지연된 백오프 끝남)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', nextAttemptAt: FIXED_NOW - 5000 });

      const picked = await service.pickReady(10);
      expect(picked.map((r) => r.id)).toEqual(['a']);
    });

    test('미래 / 경계 / 과거 혼합 시 도래된 행만 픽업', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'past', nextAttemptAt: FIXED_NOW - 1 });
      seedRow(db, { id: 'now', nextAttemptAt: FIXED_NOW });
      seedRow(db, { id: 'future', nextAttemptAt: FIXED_NOW + 1 });

      const picked = await service.pickReady(10);
      const ids = picked.map((r) => r.id).sort();
      expect(ids).toEqual(['now', 'past']);
    });
  });

  // ── 6. limit ──────────────────────────────────────────────────────

  describe('limit', () => {
    test('가용 행이 limit 보다 많으면 limit 개만 픽업', async () => {
      const { service, db } = setup;
      for (let i = 0; i < 5; i++) {
        seedRow(db, { id: `a-${i}`, createdAt: i });
      }

      const picked = await service.pickReady(2);
      expect(picked).toHaveLength(2);
    });

    test('가용 행이 limit 보다 적으면 가용분만 픽업', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });
      seedRow(db, { id: 'b' });

      const picked = await service.pickReady(10);
      expect(picked).toHaveLength(2);
    });

    test('limit = 0 이면 빈 배열, 부수효과 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      const picked = await service.pickReady(0);
      expect(picked).toEqual([]);

      // 행은 그대로 PENDING
      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'a'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 7. FIFO 순서 ──────────────────────────────────────────────────

  describe('FIFO 순서 (createdAt ASC)', () => {
    test('먼저 enqueue 된 (createdAt 작은) 행이 먼저 픽업', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'late', createdAt: 300 });
      seedRow(db, { id: 'mid', createdAt: 200 });
      seedRow(db, { id: 'early', createdAt: 100 });

      const picked = await service.pickReady(10);
      expect(picked.map((r) => r.id)).toEqual(['early', 'mid', 'late']);
    });

    test('limit 이 가용보다 작으면 오래된 것부터 limit 개만 픽업', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'late', createdAt: 300 });
      seedRow(db, { id: 'mid', createdAt: 200 });
      seedRow(db, { id: 'early', createdAt: 100 });

      const picked = await service.pickReady(2);
      expect(picked.map((r) => r.id)).toEqual(['early', 'mid']);

      // 'late' 는 PENDING 그대로
      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'late'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 8. 원자성 / 동시 호출 안전성 ──────────────────────────────────

  describe('원자성', () => {
    test('연속 호출 시 같은 행이 두 번 픽업되지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      const first = await service.pickReady(10);
      const second = await service.pickReady(10);

      expect(first.map((r) => r.id)).toEqual(['a']);
      expect(second).toEqual([]);
    });
  });

  // ── 9. 복합 필터 통합 ────────────────────────────────────────────

  describe('복합 필터', () => {
    test('여러 상태/의존성/시각 혼합 시 ready 한 것만 정확히 픽업', async () => {
      const { service, db } = setup;
      // ready
      seedRow(db, { id: 'r1', createdAt: 1 });
      seedRow(db, { id: 'r2', createdAt: 2 });
      // not ready: 다른 status
      seedRow(db, {
        id: 'in-flight',
        status: OUTBOX_STATUS.IN_FLIGHT,
        createdAt: 3,
      });
      seedRow(db, {
        id: 'success',
        status: OUTBOX_STATUS.SUCCESS,
        createdAt: 4,
      });
      seedRow(db, {
        id: 'cancelled',
        status: OUTBOX_STATUS.CANCELLED,
        createdAt: 5,
      });
      // not ready: 의존성
      seedRow(db, { id: 'blocked', pendingDepsCount: 2, createdAt: 6 });
      // not ready: 백오프 미도래
      seedRow(db, {
        id: 'backoff',
        nextAttemptAt: FIXED_NOW + 10_000,
        createdAt: 7,
      });

      const picked = await service.pickReady(10);
      expect(picked.map((r) => r.id)).toEqual(['r1', 'r2']);
    });
  });
});
