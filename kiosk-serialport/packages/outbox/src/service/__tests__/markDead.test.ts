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
      onDepFail: opts.onDepFail ?? ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
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

describe('OutboxService.markDead', () => {
  // ── 1. 기본 전이 ────────────────────────────────────────────────────

  describe('기본 전이 (IN_FLIGHT → DEAD)', () => {
    test('status 가 DEAD 로 전이', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      await service.markDead('a', 'permanent err');

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.DEAD);
    });

    test('attempts 가 1 증가 (이번 시도가 영구 실패로 끝났음을 반영)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 2 });

      await service.markDead('a', 'err');

      expect(getRow(db, 'a')?.attempts).toBe(3);
    });

    test('lastError 에 메시지 저장', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      await service.markDead('a', 'server returned 400 INVALID_INPUT');

      expect(getRow(db, 'a')?.lastError).toBe(
        'server returned 400 INVALID_INPUT',
      );
    });

    test('updatedAt 은 clock.now() 로 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'a' });
      clock.set(FIXED_NOW + 9_000);

      await service.markDead('a', 'err');

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 9_000);
    });

    test('createdAt 은 변경되지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', createdAt: 100 });

      await service.markDead('a', 'err');

      expect(getRow(db, 'a')?.createdAt).toBe(100);
    });
  });

  // ── 2. 자식 없음 ──────────────────────────────────────────────────

  describe('자식이 없는 경우', () => {
    test('자식 없으면 다른 행 영향 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });
      seedRow(db, {
        id: 'unrelated',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 5,
      });

      await service.markDead('a', 'err');

      const u = getRow(db, 'unrelated');
      expect(u?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(u?.pendingDepsCount).toBe(5);
    });
  });

  // ── 3. CANCEL 정책 자식 ───────────────────────────────────────────

  describe('CANCEL 정책 자식 cascade', () => {
    test('자식 1개 (onDepFail=CANCEL) → CANCELLED 로 cascade', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('자식 N개 모두 (CANCEL) → 모두 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      for (const c of ['c1', 'c2', 'c3']) {
        seedRow(db, {
          id: c,
          status: OUTBOX_STATUS.PENDING,
          onDepFail: ON_DEP_FAIL.CANCEL,
          pendingDepsCount: 1,
        });
        seedDep(db, 'p', c);
      }

      await service.markDead('p', 'err');

      for (const c of ['c1', 'c2', 'c3']) {
        expect(getRow(db, c)?.status).toBe(OUTBOX_STATUS.CANCELLED);
      }
    });

    test('cascade 된 자식의 attempts 는 그대로 (cascade 는 시도 아님)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        attempts: 2,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.attempts).toBe(2);
    });
  });

  // ── 4. PROCEED 정책 자식 ──────────────────────────────────────────

  describe('PROCEED 정책 자식', () => {
    test('PROCEED 자식 (deps=2) → deps=1, status=PENDING 유지', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 2,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(c?.pendingDepsCount).toBe(1);
    });

    test('PROCEED 자식 (deps=1) → deps=0 (이제 ready)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    });

    test('PROCEED 자식의 손자는 안 건드림 (PROCEED 자식이 terminal-failure 아니므로)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.markDead('p', 'err');

      // c 는 PROCEED 라 PENDING 유지 — terminal-failure 아님
      // 따라서 g 에 cascade 안 일어남
      const g = getRow(db, 'g');
      expect(g?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(g?.pendingDepsCount).toBe(1);
    });
  });

  // ── 5. 혼합 (CANCEL + PROCEED) ─────────────────────────────────────

  describe('혼합 자식', () => {
    test('CANCEL 자식 + PROCEED 자식 동시에 정확히 처리', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c-cancel',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'c-proceed',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c-cancel');
      seedDep(db, 'p', 'c-proceed');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c-cancel')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      const cp = getRow(db, 'c-proceed');
      expect(cp?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(cp?.pendingDepsCount).toBe(0);
    });
  });

  // ── 6. 다단 cascade ────────────────────────────────────────────────

  describe('다단 cascade', () => {
    test('P → C(CANCEL) → G(CANCEL): P DEAD 시 C, G 모두 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      expect(getRow(db, 'g')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('P → C(CANCEL) → G(PROCEED): C 가 terminal-failure 가 되어 G 의 카운터 감소', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedRow(db, {
        id: 'g',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');
      seedDep(db, 'c', 'g');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      const g = getRow(db, 'g');
      expect(g?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(g?.pendingDepsCount).toBe(0);
    });

    test('깊은 체인 (5단계 CANCEL) — 모두 CANCELLED 까지 cascade', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'L0' });
      for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
        seedRow(db, {
          id,
          status: OUTBOX_STATUS.PENDING,
          onDepFail: ON_DEP_FAIL.CANCEL,
          pendingDepsCount: 1,
        });
      }
      seedDep(db, 'L0', 'L1');
      seedDep(db, 'L1', 'L2');
      seedDep(db, 'L2', 'L3');
      seedDep(db, 'L3', 'L4');
      seedDep(db, 'L4', 'L5');

      await service.markDead('L0', 'err');

      for (const id of ['L1', 'L2', 'L3', 'L4', 'L5']) {
        expect(getRow(db, id)?.status).toBe(OUTBOX_STATUS.CANCELLED);
      }
    });
  });

  // ── 7. 자식이 이미 종결 상태 ──────────────────────────────────────

  describe('자식이 이미 종결 상태', () => {
    // 'SUCCESS' 자식은 정상 흐름으로 발생 불가 (부모가 SUCCESS/RESOLVED_EXTERNAL 일 때만
    // 자식이 픽업되어 SUCCESS 가능) → 테스트 폐기.

    test('자식이 RESOLVED_EXTERNAL → 건드리지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
        onDepFail: ON_DEP_FAIL.CANCEL,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    });

    test('자식이 이미 CANCELLED → 그대로 (재 cascade 안 일어남)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.CANCELLED,
        onDepFail: ON_DEP_FAIL.CANCEL,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('자식이 이미 DEAD → 그대로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.DEAD,
        onDepFail: ON_DEP_FAIL.CANCEL,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.DEAD);
    });
  });

  // ── 8. 멱등성 / 잘못된 상태 ────────────────────────────────────────

  describe('멱등성 / 잘못된 상태', () => {
    test('이미 DEAD 인 행에 호출 → no-op (자식 cascade 재실행 안 됨)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD, attempts: 5 });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      // p 의 attempts 는 변동 없음, c 도 cascade 안 일어남
      expect(getRow(db, 'p')?.attempts).toBe(5);
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
    });

    test('PENDING 행에 호출 → no-op', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.PENDING });

      await service.markDead('p', 'err');

      expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('존재하지 않는 id → throw 안 함, 부수효과 없음', async () => {
      const { service, db } = setup;

      await service.markDead('ghost', 'err');

      expect(db.select().from(outboxMutation).all()).toHaveLength(0);
    });
  });

  // ── 9. DAG (multi-parent) ──────────────────────────────────────────

  describe('DAG — 자식이 여러 부모를 의존하는 경우', () => {
    test('C (CANCEL, deps=2, P1+P2 의존), markDead(P1) → C도 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1' });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 2,
      });
      seedDep(db, 'p1', 'c');
      seedDep(db, 'p2', 'c');

      await service.markDead('p1', 'err');

      // CANCEL 자식은 부모 1개만 terminal-failure 여도 즉시 CANCELLED
      expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.CANCELLED);
      // 다른 부모 P2 는 영향 없음
      expect(getRow(db, 'p2')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('C (PROCEED, deps=2, P1+P2 의존), markDead(P1) → deps=1 (P2 만큼 남음)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1' });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.PROCEED,
        pendingDepsCount: 2,
      });
      seedDep(db, 'p1', 'c');
      seedDep(db, 'p2', 'c');

      await service.markDead('p1', 'err');

      const c = getRow(db, 'c');
      expect(c?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(c?.pendingDepsCount).toBe(1);
    });
  });

  // ── 10. 운영자 가시성 — resolutionReason ───────────────────────────

  describe('cascade CANCELLED 행의 resolutionReason', () => {
    test('cascade 로 CANCELLED 된 자식의 resolutionReason 은 null 이 아님', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p' });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        onDepFail: ON_DEP_FAIL.CANCEL,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markDead('p', 'err');

      // 운영자가 "왜 cancelled 되었는지" 알 수 있어야 함 (정확한 문자열은 impl 자유)
      expect(getRow(db, 'c')?.resolutionReason).not.toBeNull();
    });
  });
});
