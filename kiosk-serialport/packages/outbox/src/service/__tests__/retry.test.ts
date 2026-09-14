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
  nextAttemptAt?: number | null;
  createdAt?: number;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: 'someType',
      payload: {},
      status: opts.status ?? OUTBOX_STATUS.DEAD,
      rootId: opts.id,
      onDepFail: opts.onDepFail ?? ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      resolutionReason: opts.resolutionReason ?? null,
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

describe('OutboxService.retry', () => {
  // ── 1. 기본 전이 ────────────────────────────────────────────────────

  describe('기본 전이 — 진입 상태별', () => {
    test('DEAD → PENDING (가장 흔한 케이스)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
        lastError: 'final',
      });

      const result = await service.retry({ id: 'a' });

      expect(result.success).toBe(true);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('CANCELLED → PENDING (잘못 cancel 됐거나 cascade 로 cancel 된 행 부활)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'cascade earlier',
      });

      await service.retry({ id: 'a' });

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('attempts → 0 리셋 (max 부터 다시 카운트)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.DEAD, attempts: 15 });

      await service.retry({ id: 'a' });

      expect(getRow(db, 'a')?.attempts).toBe(0);
    });

    test('lastError → null 클리어 (깨끗한 새 시작)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        lastError: 'final err',
      });

      await service.retry({ id: 'a' });

      expect(getRow(db, 'a')?.lastError).toBeNull();
    });

    test('resolutionReason → null 클리어 (PENDING 행에 reason 있으면 어색)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'auto-cascaded',
      });

      await service.retry({ id: 'a' });

      expect(getRow(db, 'a')?.resolutionReason).toBeNull();
    });
  });

  // ── 2. nextAttemptAt / updatedAt / createdAt ──────────────────────

  describe('타임스탬프', () => {
    test('nextAttemptAt → clock.now() (즉시 픽업 가능)', async () => {
      const { service, clock, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        nextAttemptAt: FIXED_NOW + 999_999, // 미래에 박혀있던
      });
      clock.set(FIXED_NOW + 5_000);

      await service.retry({ id: 'a' });

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + 5_000);
    });

    test('updatedAt 갱신, createdAt 보존', async () => {
      const { service, clock, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        createdAt: 100,
      });
      clock.set(FIXED_NOW + 7_000);

      await service.retry({ id: 'a' });

      const row = getRow(db, 'a');
      expect(row?.createdAt).toBe(100);
      expect(row?.updatedAt).toBe(FIXED_NOW + 7_000);
    });
  });

  // ── 3. 거부 — INVALID_STATE_TRANSITION ────────────────────────────

  describe('거부 — 비-종결-실패 진입 상태', () => {
    test('PENDING 행 → 거부 (이미 픽업 대기, retry 무의미)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.PENDING,
        attempts: 2,
      });

      const result = await service.retry({ id: 'a' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(result.code).toBe(OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION);
      // 행 상태 유지 (attempts 리셋되지 않음)
      expect(getRow(db, 'a')?.attempts).toBe(2);
    });

    test('IN_FLIGHT 행 → 거부 (진행 중)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      const result = await service.retry({ id: 'a' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
    });

    test('SUCCESS 행 → 거부', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.SUCCESS });

      const result = await service.retry({ id: 'a' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
    });

    test('RESOLVED_EXTERNAL 행 → 거부', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.RESOLVED_EXTERNAL });

      const result = await service.retry({ id: 'a' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
    });
  });

  // ── 3-b. EXPIRED 는 되살릴 수 없다 ─────────────────────────────────

  /**
   * EXPIRED 를 DEAD 와 가른 이유가 여기 하나로 모인다. 어떤 작업은 늦은 성공이
   * 안 하느니만 못한데, 상태로 갈라두지 않으면 콘솔이 그 구분을 못 해 직원이
   * 무심코 되살린다.
   */
  describe('EXPIRED 거부 — 늦은 성공이 사고인 작업 보호', () => {
    test('EXPIRED 행 → INVALID_STATE_TRANSITION', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.EXPIRED,
        attempts: 6,
      });

      const result = await service.retry({ id: 'a' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('INVALID_STATE_TRANSITION');
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.EXPIRED);
      expect(getRow(db, 'a')?.attempts).toBe(6);
    });

    test('cascade 도 일어나지 않는다 — 거부는 부수효과가 없다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.EXPIRED });
      seedRow(db, { id: 'c', status: OUTBOX_STATUS.CANCELLED });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });
  });

  // ── 4. NOT_FOUND ──────────────────────────────────────────────────

  describe('NOT_FOUND', () => {
    test('존재하지 않는 id → NOT_FOUND, 부수효과 없음', async () => {
      const { service, db } = setup;

      const result = await service.retry({ id: 'ghost' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('NOT_FOUND');
      expect(db.select().from(outboxMutation).all()).toHaveLength(0);
    });
  });

  // ── 5. 자식 counter 안 건드림 (resolve 와의 핵심 차이) ────────────

  describe('자식 counter 건드리지 않음 (target 이 종결-성공 아니므로)', () => {
    test('PENDING 자식: counter 그대로 (resolve 와 다름)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      // p 가 다시 PENDING 으로 가니까 c 는 여전히 p 를 기다림
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
    });

    test('CANCELLED 자식: counter 그대로 (REACTIVATE 시에도)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      // c 는 PENDING 으로 부활하지만 counter 는 그대로 1 (p 기다리는 중)
      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(c?.pendingDepsCount).toBe(1);
    });
  });

  // ── 6. cascade=REACTIVATE (기본) ─────────────────────────────────

  describe('cascade=REACTIVATE — CANCELLED 후손 부활', () => {
    test('cascade 옵션 미지정 시 기본값은 REACTIVATE', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('직접 CANCELLED 자식 → PENDING', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({
        id: 'p',
        cascade: CASCADE_POLICY.REACTIVATE,
      });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
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

      await service.retry({ id: 'p' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('비-CANCELLED 후손은 BFS frontier 진입 안 함 (cascade 멈춤)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.retry({ id: 'p' });

      // c: PENDING 그대로 (CANCELLED 가 아니라 reactivate 대상 아님)
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
      // g: c 통해 cascade 가 도달 못 해서 그대로 CANCELLED
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });
  });

  // ── 7. cascade=LEAVE ──────────────────────────────────────────────

  describe('cascade=LEAVE — CANCELLED 후손 그대로', () => {
    test('CANCELLED 자식 status 보존 (counter 도 그대로)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p', cascade: CASCADE_POLICY.LEAVE });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(c?.pendingDepsCount).toBe(1);
    });
  });

  // ── 8. cascade=CANCEL ─────────────────────────────────────────────

  describe('cascade=CANCEL — LEAVE 와 동일 동작', () => {
    test('CANCELLED 자식 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p', cascade: CASCADE_POLICY.CANCEL });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });
  });

  // ── 9. 종결 후손 무시 ────────────────────────────────────────────

  describe('종결-성공/DEAD 후손 무시', () => {
    test('SUCCESS 후손 → 그대로 (counter 도 안 건드림)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.SUCCESS,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.SUCCESS);
      expect(c?.pendingDepsCount).toBe(1); // retry 는 counter 안 건드림
    });

    test('RESOLVED_EXTERNAL 후손 → 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    });

    test('DEAD 후손 → 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
        lastError: 'died',
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.DEAD);
      expect(c?.lastError).toBe('died');
    });
  });

  // ── 10. DAG / multi-parent ───────────────────────────────────────

  describe('DAG — multi-parent', () => {
    test('multi-parent CANCELLED 자식: REACTIVATE 시 PENDING, counter 그대로 (다른 부모 미해결)', async () => {
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

      await service.retry({ id: 'p1' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      // counter 는 그대로 — retry 는 자식 counter 안 건드림 (resolve 와 차이)
      expect(c?.pendingDepsCount).toBe(2);
      // p2 는 영향 없음
      expect(getRow(db, 'p2')?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 11. resolutionReason audit ───────────────────────────────────

  describe('resolutionReason — REACTIVATE 후손 audit 보존', () => {
    test('reactivate 된 후손의 기존 resolutionReason 보존', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        resolutionReason: 'auto-cascaded from DEAD: p',
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.retry({ id: 'p' });

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      // 왜 한번 cancelled 됐었는지 audit
      expect(c?.resolutionReason).toBe('auto-cascaded from DEAD: p');
    });
  });
});
