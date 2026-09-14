import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_RETRY_POLICY,
  ON_DEP_FAIL,
  OUTBOX_STATUS,
  type OutboxStatus,
} from 'kiosk-types';
import { createTestDb, FakeClock } from '../../__test-utils__/test-db';
import type { Db } from '../../db';
import { outboxDependency, outboxMutation } from '../../db';
import { OutboxService } from '../OutboxService';

// ── setup ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;
const DEFERRED = DEFAULT_RETRY_POLICY.DEFERRED_RETRY_MS;

type Setup = {
  db: Db;
  clock: FakeClock;
  service: OutboxService;
  cleanup: () => void;
};

function setupService(random: () => number = () => 0.5): Setup {
  const { db, cleanup } = createTestDb();
  const clock = new FakeClock(FIXED_NOW);
  const service = new OutboxService({ db, clock: clock.now, random });
  return { db, clock, service, cleanup };
}

type SeedOpts = {
  id: string;
  status?: OutboxStatus;
  attempts?: number;
  lastError?: string | null;
  resolutionReason?: string | null;
  expiresAt?: number | null;
  pendingDepsCount?: number;
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
      resolutionReason: opts.resolutionReason ?? null,
      nextAttemptAt: FIXED_NOW,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .run();
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

/**
 * markDeferred 는 "묻지도 못했다" 를 기록한다. markFailure 와 갈리는 축은 하나 —
 * 시도를 세지 않는다. 이 구분이 없으면 오프라인이 큐를 통째로 DEAD 로 만든다.
 */
describe('OutboxService.markDeferred', () => {
  // ── 1. 기본 전이 ────────────────────────────────────────────────────

  describe('기본 전이 (IN_FLIGHT → PENDING)', () => {
    test('status 가 PENDING 으로 돌아온다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('updatedAt 이 갱신된다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a' });
      clock.advance(5_000);

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 5_000);
    });
  });

  // ── 2. 시도를 세지 않는다 (핵심) ────────────────────────────────────

  describe('attempts 를 소모하지 않는다', () => {
    test('attempts=0 → 그대로 0', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 0 });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.attempts).toBe(0);
    });

    test('attempts=7 → 그대로 7', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 7 });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.attempts).toBe(7);
    });

    test('attempts 가 아무리 쌓여도 종결되지 않는다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 14 });

      await service.markDeferred('a');

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.attempts).toBe(14);
    });

    test('100번 defer 해도 attempts 는 0 — 오프라인은 시도가 아니다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', attempts: 0 });

      // 오프라인 100회 — 큐가 살아 있어야 한다
      for (let i = 0; i < 100; i++) {
        db.update(outboxMutation)
          .set({ status: OUTBOX_STATUS.IN_FLIGHT })
          .where(eq(outboxMutation.id, 'a'))
          .run();
        await service.markDeferred('a');
        clock.advance(DEFERRED);
      }

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.attempts).toBe(0);
    });
  });

  // ── 3. nextAttemptAt — 고정 간격 + jitter ───────────────────────────

  describe('nextAttemptAt (random=0.5 → 1.0x)', () => {
    test('now + DEFERRED_RETRY_MS', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + DEFERRED);
    });

    test('attempts 가 늘어도 간격은 그대로 — 지수 백오프를 타지 않는다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 12 });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + DEFERRED);
    });
  });

  describe('Jitter (±25%)', () => {
    test('random=0 → DEFERRED × 0.75', async () => {
      const s = setupService(() => 0);
      seedRow(s.db, { id: 'a' });

      await s.service.markDeferred('a');

      expect(getRow(s.db, 'a')?.nextAttemptAt).toBe(
        FIXED_NOW + Math.floor(DEFERRED * 0.75),
      );
      s.cleanup();
    });

    test('random≈1 → DEFERRED × 1.25 근사', async () => {
      const s = setupService(() => 0.999999);
      seedRow(s.db, { id: 'a' });

      await s.service.markDeferred('a');

      const delta = (getRow(s.db, 'a')?.nextAttemptAt ?? 0) - FIXED_NOW;
      expect(delta).toBeGreaterThan(DEFERRED * 1.24);
      expect(delta).toBeLessThanOrEqual(DEFERRED * 1.25);
      s.cleanup();
    });
  });

  // ── 4. 보존 ─────────────────────────────────────────────────────────

  describe('시도 결과가 아니므로 아무것도 덮어쓰지 않는다', () => {
    test('lastError 를 덮어쓰지 않는다 — 직전 서버 에러가 forensics 다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 3, lastError: 'folio locked (500)' });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.lastError).toBe('folio locked (500)');
    });

    test('resolutionReason 을 건드리지 않는다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', resolutionReason: '직원 메모' });

      await service.markDeferred('a');

      expect(getRow(db, 'a')?.resolutionReason).toBe('직원 메모');
    });

    test('직접 자식의 pendingDepsCount 를 건드리지 않는다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      db.insert(outboxDependency).values({ parentId: 'p', childId: 'c' }).run();

      await service.markDeferred('p');

      expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 5. 멱등성 / 잘못된 상태 ─────────────────────────────────────────

  describe('멱등성 / 잘못된 상태', () => {
    test.each([
      OUTBOX_STATUS.PENDING,
      OUTBOX_STATUS.SUCCESS,
      OUTBOX_STATUS.DEAD,
      OUTBOX_STATUS.CANCELLED,
      OUTBOX_STATUS.RESOLVED_EXTERNAL,
    ])('IN_FLIGHT 가 아닌 %s 행에 호출 → no-op', async (status) => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status, attempts: 4 });

      await service.markDeferred('a');

      const row = getRow(db, 'a');
      expect(row?.status).toBe(status);
      expect(row?.attempts).toBe(4);
      expect(row?.nextAttemptAt).toBe(FIXED_NOW);
    });

    test('미존재 id → throw 없이 no-op', async () => {
      const { service } = setup;

      await service.markDeferred('nope');
    });
  });
});
