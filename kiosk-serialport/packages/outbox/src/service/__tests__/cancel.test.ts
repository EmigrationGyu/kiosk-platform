import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  ON_DEP_FAIL,
  type OnDepFail,
  OUTBOX_ERROR_CODE,
  OUTBOX_STATUS,
  type OutboxStatus,
} from 'kiosk-types';
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
  onDepFail?: OnDepFail;
  attempts?: number;
  pendingDepsCount?: number;
  lastError?: string | null;
  resolutionReason?: string | null;
  createdAt?: number;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: 'someType',
      payload: {},
      status: opts.status ?? OUTBOX_STATUS.PENDING,
      rootId: opts.id,
      onDepFail: opts.onDepFail ?? ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      resolutionReason: opts.resolutionReason ?? null,
      nextAttemptAt: FIXED_NOW,
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

describe('OutboxService.cancel', () => {
  // ── 1. 기본 전이 ────────────────────────────────────────────────────

  describe('기본 전이 — 진입 상태별', () => {
    test('PENDING → CANCELLED + 운영자 reason 저장', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.PENDING });

      const result = await service.cancel({ id: 'a', reason: 'wrong guest' });

      expect(result.success).toBe(true);
      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(row?.resolutionReason).toBe('wrong guest');
    });

    test('IN_FLIGHT → CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      await service.cancel({ id: 'a', reason: 'op decision' });

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('DEAD → CANCELLED 허용 (운영자가 최종 폐기 결정 — 옵션 A)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
        lastError: 'final error',
      });

      const result = await service.cancel({ id: 'a', reason: 'give up' });

      expect(result.success).toBe(true);
      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(row?.resolutionReason).toBe('give up');
    });

    test('updatedAt 은 clock.now() 로 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'a' });
      clock.set(FIXED_NOW + 11_000);

      await service.cancel({ id: 'a', reason: 'r' });

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 11_000);
    });

    test('createdAt / attempts / lastError 는 변경되지 않음 (cancel 은 시도 아님)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        attempts: 3,
        lastError: 'previous err',
        createdAt: 100,
      });

      await service.cancel({ id: 'a', reason: 'r' });

      const row = getRow(db, 'a');
      expect(row?.createdAt).toBe(100);
      expect(row?.attempts).toBe(3);
      expect(row?.lastError).toBe('previous err');
    });
  });

  // ── 2. 종결 상태 거부 ─────────────────────────────────────────────

  describe('종결 상태 행 거부 — INVALID_STATE_TRANSITION', () => {
    test('SUCCESS 행 → 거부, DB 변경 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.SUCCESS });

      const result = await service.cancel({ id: 'a', reason: 'r' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(result.code).toBe(OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    });

    test('RESOLVED_EXTERNAL 행 → 거부', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.RESOLVED_EXTERNAL });

      const result = await service.cancel({ id: 'a', reason: 'r' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    });

    test('이미 CANCELLED 행 → 거부 (재취소 의미 없음)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'previous reason',
      });

      const result = await service.cancel({ id: 'a', reason: 'new reason' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      // resolutionReason 도 그대로 유지 (덮어쓰지 않음)
      expect(getRow(db, 'a')?.resolutionReason).toBe('previous reason');
    });
    test('EXPIRED 행 → 거부. 폐기로 덮으면 시효가 지났다는 사실이 지워진다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.EXPIRED });

      const result = await service.cancel({ id: 'a', reason: '직원 폐기' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.EXPIRED);
    });
  });

  // ── 3. NOT_FOUND ──────────────────────────────────────────────────

  describe('NOT_FOUND', () => {
    test('존재하지 않는 id → NOT_FOUND, 부수효과 없음', async () => {
      const { service, db } = setup;

      const result = await service.cancel({ id: 'ghost', reason: 'r' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('NOT_FOUND');
      expect(result.code).toBe(OUTBOX_ERROR_CODE.NOT_FOUND);
      expect(db.select().from(outboxMutation).all()).toHaveLength(0);
    });
  });

  // ── 4. cascade — 직접 자식 ───────────────────────────────────────

  describe('cascade — 직접 자식', () => {
    test('자식 1개 → CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'c', status: OUTBOX_STATUS.PENDING });
      seedDep(db, 'p', 'c');

      await service.cancel({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('자식 N개 모두 → 모두 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      for (const c of ['c1', 'c2', 'c3']) {
        seedRow(db, { id: c });
        seedDep(db, 'p', c);
      }

      await service.cancel({ id: 'p', reason: 'r' });

      for (const c of ['c1', 'c2', 'c3']) {
        expect(getRow(db, c)?.status).toBe(OUTBOX_STATUS.CANCELLED);
      }
    });

    test('자식의 onDepFail 무시 — PROCEED 자식도 CANCELLED (operator override)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c-cancel',
        onDepFail: ON_DEP_FAIL.CANCEL,
      });
      seedRow(db, {
        id: 'c-proceed',
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c-cancel');
      seedDep(db, 'p', 'c-proceed');

      await service.cancel({ id: 'p', reason: 'kill all' });

      expect(getRow(db, 'c-cancel')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      // PROCEED 였더라도 cancel cascade 는 무조건 CANCELLED
      expect(getRow(db, 'c-proceed')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('cascade 자식의 attempts / lastError 는 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        attempts: 4,
        lastError: 'previous transient',
      });
      seedDep(db, 'p', 'c');

      await service.cancel({ id: 'p', reason: 'r' });

      const c = getRow(db, 'c');
      expect(c?.attempts).toBe(4);
      expect(c?.lastError).toBe('previous transient');
    });
  });

  // ── 5. cascade — 다단 ────────────────────────────────────────────

  describe('cascade — 다단 / DAG', () => {
    test('깊은 체인 (5단계) — 모두 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'L0' });
      for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
        seedRow(db, { id });
      }
      seedDep(db, 'L0', 'L1');
      seedDep(db, 'L1', 'L2');
      seedDep(db, 'L2', 'L3');
      seedDep(db, 'L3', 'L4');
      seedDep(db, 'L4', 'L5');

      await service.cancel({ id: 'L0', reason: 'r' });

      for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
        expect(getRow(db, id)?.status).toBe(OUTBOX_STATUS.CANCELLED);
      }
    });

    test('DAG: 자식이 두 부모(P1, P2)에 의존 — cancel(P1) 만으로도 자식 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1' });
      seedRow(db, { id: 'p2' });
      seedRow(db, { id: 'c', pendingDepsCount: 2 });
      seedDep(db, 'p1', 'c');
      seedDep(db, 'p2', 'c');

      await service.cancel({ id: 'p1', reason: 'r' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      // 다른 부모 P2 는 영향 없음
      expect(getRow(db, 'p2')?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 6. cascade — 종결 상태 자식 무시 ────────────────────────────

  describe('cascade — 종결 상태 자식 무시', () => {
    test('RESOLVED_EXTERNAL 자식 → 건드리지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
        resolutionReason: 'manually handled',
      });
      seedDep(db, 'p', 'c');

      await service.cancel({ id: 'p', reason: 'r' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
      expect(c?.resolutionReason).toBe('manually handled');
    });

    test('이미 CANCELLED 자식 → 그대로 (재처리 없음, reason 보존)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'cancelled earlier',
      });
      seedDep(db, 'p', 'c');

      await service.cancel({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.resolutionReason).toBe('cancelled earlier');
    });

    test('DEAD 자식 → 그대로 (cascade 가 DEAD 를 CANCELLED 로 변환하지 않음)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
        lastError: 'died',
      });
      seedDep(db, 'p', 'c');

      await service.cancel({ id: 'p', reason: 'r' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.DEAD);
      expect(c?.lastError).toBe('died'); // 그대로 보존
    });
  });

  // ── 7. resolutionReason 분리 ─────────────────────────────────────

  describe('resolutionReason — 직접 행 vs cascade 행', () => {
    test('직접 cancel 된 행: 운영자 reason 그대로 저장', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });

      await service.cancel({ id: 'p', reason: 'guest changed mind' });

      expect(getRow(db, 'p')?.resolutionReason).toBe('guest changed mind');
    });

    test('cascade 로 cancelled 된 행: cascade 식별 가능한 reason (운영자 reason 과 구분)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, { id: 'c' });
      seedDep(db, 'p', 'c');

      await service.cancel({ id: 'p', reason: 'guest changed mind' });

      const cReason = getRow(db, 'c')?.resolutionReason;
      // 정확한 문자열은 impl 자유. 운영자 reason 과는 구분되어야 함.
      expect(cReason).not.toBeNull();
      expect(cReason).not.toBe('guest changed mind');
    });
  });
});
