import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  CASCADE_POLICY,
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

describe('OutboxService.resolve', () => {
  // ── 1. 기본 전이 — 진입 상태별 ─────────────────────────────────────

  describe('기본 전이 — 진입 상태별', () => {
    test('PENDING → RESOLVED_EXTERNAL + 운영자 reason', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.PENDING });

      const result = await service.resolve({ id: 'a', reason: 'handled' });

      expect(result.success).toBe(true);
      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
      expect(row?.resolutionReason).toBe('handled');
    });

    test('IN_FLIGHT → RESOLVED_EXTERNAL', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      await service.resolve({ id: 'a', reason: 'r' });

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    });

    test('DEAD → RESOLVED_EXTERNAL (가장 흔한 케이스 — 자동 retry 포기 후 수동 처리)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
        lastError: 'final err',
      });

      await service.resolve({ id: 'a', reason: 'manually fixed' });

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
      expect(row?.resolutionReason).toBe('manually fixed');
    });

    test('CANCELLED → RESOLVED_EXTERNAL (cascade 로 cancelled 됐는데 외부 처리)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'auto-cascaded earlier',
      });

      await service.resolve({ id: 'a', reason: 'actually I did it' });

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
      expect(row?.resolutionReason).toBe('actually I did it');
    });

    test('createdAt / attempts / lastError 는 변경되지 않음, updatedAt 만 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, {
        id: 'a',
        attempts: 3,
        lastError: 'transient',
        createdAt: 100,
      });
      clock.set(FIXED_NOW + 12_000);

      await service.resolve({ id: 'a', reason: 'r' });

      const row = getRow(db, 'a');
      expect(row?.createdAt).toBe(100);
      expect(row?.attempts).toBe(3);
      expect(row?.lastError).toBe('transient');
      expect(row?.updatedAt).toBe(FIXED_NOW + 12_000);
    });
  });

  // ── 2. 종결-성공 거부 ─────────────────────────────────────────────

  describe('종결-성공 상태 거부', () => {
    test('SUCCESS → INVALID_STATE_TRANSITION, DB 변경 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.SUCCESS });

      const result = await service.resolve({ id: 'a', reason: 'r' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(result.code).toBe(OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    });

    test('RESOLVED_EXTERNAL → INVALID_STATE_TRANSITION', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
        resolutionReason: 'previously resolved',
      });

      const result = await service.resolve({ id: 'a', reason: 'new reason' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(getRow(db, 'a')?.resolutionReason).toBe('previously resolved');
    });
    test('EXPIRED 행 → RESOLVED_EXTERNAL 로 종결 가능 (외부에서 처리했다)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.EXPIRED });

      const result = await service.resolve({
        id: 'a',
        reason: '프론트데스크에서 수기 처리',
      });

      expect(result.success).toBe(true);
      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
      expect(row?.resolutionReason).toBe('프론트데스크에서 수기 처리');
    });
  });

  // ── 3. NOT_FOUND ──────────────────────────────────────────────────

  describe('NOT_FOUND', () => {
    test('존재하지 않는 id → NOT_FOUND, 부수효과 없음', async () => {
      const { service, db } = setup;

      const result = await service.resolve({ id: 'ghost', reason: 'r' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('NOT_FOUND');
      expect(db.select().from(outboxMutation).all()).toHaveLength(0);
    });
  });

  // ── 4. 직접 자식 counter 감소 (cascade 옵션 무관) ───────────────

  describe('직접 자식 counter 감소 (모든 cascade 옵션 공통)', () => {
    test('PENDING 자식: counter--', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    });

    test('CANCELLED 자식도 counter-- (status 무관 — 일관성)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      // LEAVE 옵션으로 status reactivate 안 시키고 counter 만 감소 검증
      await service.resolve({
        id: 'p',
        reason: 'r',
        cascade: CASCADE_POLICY.LEAVE,
      });

      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    });

    test('자식 updatedAt 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, { id: 'c', pendingDepsCount: 1 });
      seedDep(db, 'p', 'c');
      clock.set(FIXED_NOW + 5_000);

      await service.resolve({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.updatedAt).toBe(FIXED_NOW + 5_000);
    });
  });

  // ── 5. cascade=REACTIVATE (기본값) ────────────────────────────────

  describe('cascade=REACTIVATE — CANCELLED 후손 부활', () => {
    test('cascade 옵션 미지정 시 기본값은 REACTIVATE', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      // cascade 옵션 명시 안 함 — REACTIVATE 적용 기대
      await service.resolve({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('직접 CANCELLED 자식 → PENDING 으로 부활', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({
        id: 'p',
        reason: 'r',
        cascade: CASCADE_POLICY.REACTIVATE,
      });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(c?.pendingDepsCount).toBe(0); // counter--
    });

    test('손자 CANCELLED → PENDING (BFS through CANCELLED)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.resolve({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('reactivate 된 후손의 counter 는 그대로 (자기 직접 부모 기준)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.resolve({ id: 'p', reason: 'r' });

      // c.deps: 1→0 (직접 자식이라 counter--)
      // g.deps: 1 그대로 (g 의 직접 부모 c 가 아직 안 끝남)
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
      expect(getRow(db, 'g')?.pendingDepsCount).toBe(1);
    });

    test('비-CANCELLED 후손은 cascade frontier 에 진입 안 함 (BFS 멈춤)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      // c 가 PENDING (CANCELLED 아님) — frontier 에 추가되지 않음
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      // g 는 CANCELLED 지만 c 를 통해 BFS 도달 못 함
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.resolve({ id: 'p', reason: 'r' });

      // c: counter--, status 그대로 (PENDING 이지 CANCELLED 가 아니라 reactivate 대상 아님)
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
      // g: 그대로 (BFS 가 c 에서 멈춰서 도달 못 함)
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(getRow(db, 'g')?.pendingDepsCount).toBe(1);
    });
  });

  // ── 6. cascade=LEAVE ──────────────────────────────────────────────

  describe('cascade=LEAVE — 후손 status 그대로', () => {
    test('CANCELLED 자식 → status 그대로, counter 만 감소', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({
        id: 'p',
        reason: 'r',
        cascade: CASCADE_POLICY.LEAVE,
      });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(c?.pendingDepsCount).toBe(0); // counter 는 항상 감소
    });

    test('손자 CANCELLED 도 그대로 (LEAVE 는 BFS reactivate 안 함)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.resolve({
        id: 'p',
        reason: 'r',
        cascade: CASCADE_POLICY.LEAVE,
      });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });
  });

  // ── 7. cascade=CANCEL ─────────────────────────────────────────────

  describe('cascade=CANCEL — LEAVE 와 동일 동작 (의미 강조)', () => {
    test('CANCELLED 자식 그대로 (LEAVE 와 동일)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({
        id: 'p',
        reason: 'r',
        cascade: CASCADE_POLICY.CANCEL,
      });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(c?.pendingDepsCount).toBe(0);
    });
  });

  // ── 8. 종결 상태 후손 — REACTIVATE 시 무시 ────────────────────────

  describe('종결-성공/DEAD 후손은 REACTIVATE 대상 아님', () => {
    test('SUCCESS 후손 그대로 (counter 감소만)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.SUCCESS,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({ id: 'p', reason: 'r' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.SUCCESS);
      expect(c?.pendingDepsCount).toBe(0); // counter 일관성 유지
    });

    test('RESOLVED_EXTERNAL 후손 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({ id: 'p', reason: 'r' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    });

    test('DEAD 후손 그대로 (자기 실패 결과 보존)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
        lastError: 'died',
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({ id: 'p', reason: 'r' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.DEAD);
      expect(c?.lastError).toBe('died');
    });
  });

  // ── 9. DAG / multi-parent ──────────────────────────────────────────

  describe('DAG — 다중 부모 자식', () => {
    test('multi-parent CANCELLED 자식: counter 부분 감소, REACTIVATE 시 PENDING 이지만 picker 못 잡음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.DEAD });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 2,
      });
      seedDep(db, 'p1', 'c');
      seedDep(db, 'p2', 'c');

      await service.resolve({ id: 'p1', reason: 'r' });

      const c = getRow(db, 'c');
      // p1 만 만족 → counter 1 감소
      expect(c?.pendingDepsCount).toBe(1);
      // status REACTIVATE → PENDING
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      // p2 는 영향 없음
      expect(getRow(db, 'p2')?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 10. resolutionReason ─────────────────────────────────────────

  describe('resolutionReason 처리', () => {
    test('target 행: 운영자 reason 으로 덮어씀', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'auto-cascaded earlier',
      });

      await service.resolve({ id: 'a', reason: 'I did it manually' });

      expect(getRow(db, 'a')?.resolutionReason).toBe('I did it manually');
    });

    test('REACTIVATE 된 CANCELLED 후손: 기존 resolutionReason 보존 (audit)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'auto-cascaded from DEAD: p',
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.resolve({ id: 'p', reason: 'manual fix' });

      // c 는 PENDING 으로 부활했지만 resolutionReason 은 그대로 (왜 한 번 cancelled 됐었는지 audit)
      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(c?.resolutionReason).toBe('auto-cascaded from DEAD: p');
    });
  });
});
