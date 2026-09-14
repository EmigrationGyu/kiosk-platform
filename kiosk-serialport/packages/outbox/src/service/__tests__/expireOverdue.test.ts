import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  ON_DEP_FAIL,
  type OnDepFail,
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
  const service = new OutboxService({
    db,
    clock: clock.now,
    random: () => 0.5,
  });
  return { db, clock, service, cleanup };
}

type SeedOpts = {
  id: string;
  status?: OutboxStatus;
  expiresAt?: number | null;
  attempts?: number;
  lastError?: string | null;
  pendingDepsCount?: number;
  onDepFail?: OnDepFail;
  rootId?: string;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: 'someType',
      payload: {},
      status: opts.status ?? OUTBOX_STATUS.PENDING,
      rootId: opts.rootId ?? opts.id,
      onDepFail: opts.onDepFail ?? ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      resolutionReason: null,
      nextAttemptAt: FIXED_NOW,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      expiresAt:
        opts.expiresAt === undefined ? FIXED_NOW + 1_000 : opts.expiresAt,
      createdAt: FIXED_NOW,
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

/**
 * 자동 종결의 유일한 축. 횟수가 아니라 기한이 결정한다 — "몇 번 시도했나"는 기획도
 * 운영도 묻지 않는 수이고, 답할 수 있는 질문은 "언제까지 반영돼야 하나" 뿐이다.
 */
describe('OutboxService.expireOverdue', () => {
  // ── 1. 기한 판정 ────────────────────────────────────────────────────

  describe('무엇이 만료 대상인가', () => {
    test('expiresAt < now → EXPIRED', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 1_000 });
      clock.advance(1_001);

      expect(await service.expireOverdue()).toBe(1);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.EXPIRED);
    });

    test('expiresAt === now → 아직 유효 (경계는 포함)', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 1_000 });
      clock.advance(1_000);

      expect(await service.expireOverdue()).toBe(0);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('expiresAt 이 아직 멀면 건드리지 않는다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 100_000 });

      expect(await service.expireOverdue()).toBe(0);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('expiresAt = null (무기한) 은 아무리 지나도 만료되지 않는다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', expiresAt: null });
      clock.advance(365 * 24 * 60 * 60_000);

      expect(await service.expireOverdue()).toBe(0);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('여러 건을 한 번에 — 반환값은 만료된 개수', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 1 });
      seedRow(db, { id: 'b', expiresAt: FIXED_NOW + 1 });
      seedRow(db, { id: 'c', expiresAt: FIXED_NOW + 100_000 });
      clock.advance(1_000);

      expect(await service.expireOverdue()).toBe(2);
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 2. 어떤 상태가 만료되는가 ───────────────────────────────────────

  describe('PENDING 만 만료된다', () => {
    test('IN_FLIGHT 는 건드리지 않는다 — 이미 나간 요청은 끝까지 본다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.IN_FLIGHT,
        expiresAt: FIXED_NOW + 1,
      });
      clock.advance(1_000);

      expect(await service.expireOverdue()).toBe(0);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.IN_FLIGHT);
    });

    test.each([
      OUTBOX_STATUS.SUCCESS,
      OUTBOX_STATUS.DEAD,
      OUTBOX_STATUS.CANCELLED,
      OUTBOX_STATUS.RESOLVED_EXTERNAL,
      OUTBOX_STATUS.EXPIRED,
    ])('종결 상태 %s 는 건드리지 않는다', async (status) => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', status, expiresAt: FIXED_NOW + 1 });
      clock.advance(1_000);

      expect(await service.expireOverdue()).toBe(0);
      expect(getRow(db, 'a')?.status).toBe(status);
    });

    test('의존성 대기 중(pendingDepsCount>0)이어도 기한은 지난다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', pendingDepsCount: 2, expiresAt: FIXED_NOW + 1 });
      clock.advance(1_000);

      expect(await service.expireOverdue()).toBe(1);
      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.EXPIRED);
    });
  });

  // ── 3. 기록 ─────────────────────────────────────────────────────────

  describe('기록', () => {
    test('resolutionReason 에 만료 사실을 남긴다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 1 });
      clock.advance(1_000);

      await service.expireOverdue();

      expect(getRow(db, 'a')?.resolutionReason).toContain('expired');
    });

    test('attempts 와 lastError 는 보존한다 — 만료는 시도가 아니다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, {
        id: 'a',
        attempts: 6,
        lastError: 'folio locked',
        expiresAt: FIXED_NOW + 1,
      });
      clock.advance(1_000);

      await service.expireOverdue();

      const row = getRow(db, 'a');
      expect(row?.attempts).toBe(6);
      expect(row?.lastError).toBe('folio locked');
    });

    test('updatedAt 을 갱신한다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 1 });
      clock.advance(1_000);

      await service.expireOverdue();

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 1_000);
    });
  });

  // ── 4. cascade — DEAD 와 같은 취급 ──────────────────────────────────

  describe('후손 cascade (부모가 끝내 이뤄지지 않았다)', () => {
    test('onDepFail=CANCEL 자식은 CANCELLED 로 전파', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'p', expiresAt: FIXED_NOW + 1 });
      seedRow(db, {
        id: 'c',
        pendingDepsCount: 1,
        rootId: 'p',
        expiresAt: null,
      });
      seedDep(db, 'p', 'c');
      clock.advance(1_000);

      await service.expireOverdue();

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(getRow(db, 'c')?.resolutionReason).toContain('p');
    });

    test('손자까지 BFS 로 전파', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'p', expiresAt: FIXED_NOW + 1 });
      seedRow(db, { id: 'c', pendingDepsCount: 1, expiresAt: null });
      seedRow(db, { id: 'g', pendingDepsCount: 1, expiresAt: null });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');
      clock.advance(1_000);

      await service.expireOverdue();

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('onDepFail=PROCEED 자식은 카운터만 풀리고 계속 간다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'p', expiresAt: FIXED_NOW + 1 });
      seedRow(db, {
        id: 'c',
        pendingDepsCount: 1,
        onDepFail: ON_DEP_FAIL.PROCEED,
        expiresAt: null,
      });
      seedDep(db, 'p', 'c');
      clock.advance(1_000);

      await service.expireOverdue();

      const child = getRow(db, 'c');
      expect(child?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(child?.pendingDepsCount).toBe(0);
    });

    test('이미 종결된 자식은 건드리지 않는다', async () => {
      const { service, db, clock } = setup;
      seedRow(db, { id: 'p', expiresAt: FIXED_NOW + 1 });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.SUCCESS,
        expiresAt: null,
      });
      seedDep(db, 'p', 'c');
      clock.advance(1_000);

      await service.expireOverdue();

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    });
  });

  // ── 5. 멱등성 ───────────────────────────────────────────────────────

  test('두 번 불러도 두 번째는 0 — 이미 EXPIRED 라 대상이 아니다', async () => {
    const { service, db, clock } = setup;
    seedRow(db, { id: 'a', expiresAt: FIXED_NOW + 1 });
    clock.advance(1_000);

    expect(await service.expireOverdue()).toBe(1);
    expect(await service.expireOverdue()).toBe(0);
  });

  test('빈 큐 → 0, throw 없음', async () => {
    const { service } = setup;

    expect(await service.expireOverdue()).toBe(0);
  });
});
