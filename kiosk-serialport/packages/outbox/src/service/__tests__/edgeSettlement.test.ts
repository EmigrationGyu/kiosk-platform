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

/**
 * 엣지 정산(settled) 상호작용 시나리오.
 *
 * 감소 신호를 보내는 곳이 셋(markSuccess / 종결-실패 cascade / resolve)이라, 단일
 * 메서드 테스트로는 "엣지당 정확히 1회 감소" 불변식이 깨지는 조합이 안 잡힌다.
 * 여기 있는 것들은 전부 실제로 이중 감소(CHECK 위반) 또는 조기 ready 를 냈던 경로다.
 */

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
  pendingDepsCount?: number;
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
      attempts: 0,
      lastError: null,
      resolutionReason: null,
      nextAttemptAt: FIXED_NOW,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      expiresAt: null,
      createdAt: opts.createdAt ?? FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .run();
}

function seedDep(
  db: Db,
  parentId: string,
  childId: string,
  settled = false,
): void {
  db.insert(outboxDependency).values({ parentId, childId, settled }).run();
}

const getRow = (db: Db, id: string) =>
  db.select().from(outboxMutation).where(eq(outboxMutation.id, id)).get();

/** 불변식: 모든 행에서 pendingDepsCount == 미정산 인바운드 엣지 수. */
function expectCounterInvariant(db: Db): void {
  const rows = db.select().from(outboxMutation).all();
  const edges = db.select().from(outboxDependency).all();
  for (const r of rows) {
    const unsettled = edges.filter(
      (e) => e.childId === r.id && !e.settled,
    ).length;
    expect({ id: r.id, pendingDepsCount: r.pendingDepsCount }).toEqual({
      id: r.id,
      pendingDepsCount: unsettled,
    });
  }
}

let setup: Setup;
beforeEach(() => {
  setup = setupService();
});
afterEach(() => {
  setup.cleanup();
});

// ── markDead → resolve (이중 감소로 resolve 가 영영 불가능했던 경로) ──────

describe('DEAD 부모의 PROCEED 자식 → resolve', () => {
  test('markDead 가 정산한 엣지를 resolve 가 또 감소시키지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 1,
    });
    seedDep(db, 'p', 'c');

    await service.markDead('p', 'err');
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);

    // 예전엔 여기서 0→-1 CHECK 위반 → resolve 가 INTERNAL_ERROR 로 영영 실패했다.
    const result = await service.resolve({ id: 'p', reason: '수기 처리' });

    expect(result.success).toBe(true);
    expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });

  test('다중 부모: 정산된 엣지만 건너뛰고 나머지 부모 몫은 남는다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p1', status: OUTBOX_STATUS.IN_FLIGHT });
    seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 2,
    });
    seedDep(db, 'p1', 'c');
    seedDep(db, 'p2', 'c');

    await service.markDead('p1', 'err');
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);

    // 예전엔 조용히 1→0 이 되어 p2 완료 전에 c 가 ready 가 됐다.
    await service.resolve({ id: 'p1', reason: 'r' });

    expect(getRow(db, 'c')?.pendingDepsCount).toBe(1);
    expectCounterInvariant(db);
  });
});

// ── markDead → retry → 재실행 (markSuccess / 재-markDead 이중 감소) ────────

describe('DEAD → retry 후 재실행', () => {
  test('retry 후 성공: markSuccess 가 정산된 엣지를 또 감소시키지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 1,
    });
    seedDep(db, 'p', 'c');

    await service.markDead('p', 'err');
    await service.retry({ id: 'p' });

    const picked = await service.pickReady(10);
    expect(picked.map((r) => r.id)).toContain('p');

    // 예전엔 여기서 0→-1 CHECK 위반 → markSuccess 트랜잭션이 터져 p 가
    // IN_FLIGHT 에 갇혔다.
    await service.markSuccess('p');

    expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });

  test('retry 후 또 DEAD: cascade 가 정산된 엣지를 또 감소시키지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 1,
    });
    seedDep(db, 'p', 'c');

    await service.markDead('p', 'err');
    await service.retry({ id: 'p' });
    await service.pickReady(10); // p → IN_FLIGHT
    await service.markDead('p', 'err again');

    expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.DEAD);
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });
});

// ── DEAD → cancel → resolve (status 역산으로는 못 잡는 2단계 경로) ─────────

describe('DEAD → cancel → resolve 2단계 경로', () => {
  test('cancel 로 부모 status 가 CANCELLED 로 덮여도 정산 이력이 보존된다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 1,
    });
    seedDep(db, 'p', 'c');

    await service.markDead('p', 'err'); // c 정산: 1→0
    await service.cancel({ id: 'p', reason: '폐기' }); // p DEAD→CANCELLED, c 도 CANCELLED

    // 부모 status 만 보면 CANCELLED = "자식 감소 안 됨" 으로 오판하는 자리.
    const result = await service.resolve({ id: 'p', reason: '수기 처리' });

    expect(result.success).toBe(true);
    const c = getRow(db, 'c');
    expect(c?.status).toBe(OUTBOX_STATUS.PENDING); // REACTIVATE 부활
    expect(c?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });
});

// ── 종결-실패 부모에 늦게 enqueue 된 자식 ─────────────────────────────────

describe('종결-실패 부모에 늦게 enqueue 된 자식', () => {
  test('CANCEL: 부모를 카운트해 retry 부활 후에도 부모를 기다린다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });

    const enq = await service.enqueue({
      id: 'c',
      type: 'someType',
      payload: { query: 'mutation X' },
      dependsOn: ['p'],
    });
    expect(enq.success).toBe(true);

    const inserted = getRow(db, 'c');
    expect(inserted?.status).toBe(OUTBOX_STATUS.CANCELLED);
    expect(inserted?.pendingDepsCount).toBe(1); // cascade 로 CANCELLED 된 자식과 동형
    expect(inserted?.resolutionReason).toContain('p');

    await service.retry({ id: 'p' }); // REACTIVATE: c 도 PENDING 부활

    // 예전엔 c.deps=0 이라 부모와 같은 배치에 잡혀 순서 계약이 깨졌다.
    const picked = await service.pickReady(10);
    expect(picked.map((r) => r.id)).toEqual(['p']);

    // 부모가 완주하면 그때 풀린다.
    await service.markSuccess('p');
    const picked2 = await service.pickReady(10);
    expect(picked2.map((r) => r.id)).toEqual(['c']);
    expectCounterInvariant(db);
  });

  test('PROCEED: 엣지가 정산으로 삽입돼 이후 resolve 가 또 감소시키지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD });

    await service.enqueue({
      id: 'c',
      type: 'someType',
      payload: { query: 'mutation X' },
      dependsOn: ['p'],
      onDepFail: ON_DEP_FAIL.PROCEED,
    });

    const inserted = getRow(db, 'c');
    expect(inserted?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(inserted?.pendingDepsCount).toBe(0);

    const result = await service.resolve({ id: 'p', reason: 'r' });
    expect(result.success).toBe(true);
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });

  test('종결-성공 부모: 엣지가 정산으로 삽입돼 resolve 재진입 여지가 없다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.SUCCESS });

    await service.enqueue({
      id: 'c',
      type: 'someType',
      payload: { query: 'mutation X' },
      dependsOn: ['p'],
    });

    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });
});

// ── cascade frontier 의 부모 둘이 같은 PROCEED 자식을 가리키는 경우 ───────

describe('같은 frontier 의 다중 부모 → 공유 PROCEED 자식', () => {
  test('엣지 수만큼 감소한다 (집합으로 한 번만 빼면 카운터가 샌다)', async () => {
    const { service, db } = setup;
    // g → p1, p2 (CANCEL) / p1, p2 → c (PROCEED, deps=2)
    seedRow(db, { id: 'g', status: OUTBOX_STATUS.IN_FLIGHT });
    seedRow(db, { id: 'p1', pendingDepsCount: 1 });
    seedRow(db, { id: 'p2', pendingDepsCount: 1 });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 2,
    });
    seedDep(db, 'g', 'p1');
    seedDep(db, 'g', 'p2');
    seedDep(db, 'p1', 'c');
    seedDep(db, 'p2', 'c');

    await service.markDead('g', 'err');

    // p1, p2 는 CANCEL 이라 CANCELLED 로 cascade — 둘 다 같은 frontier 에서
    // c 에 신호를 보낸다. 예전엔 uniqueChildIds 로 접혀 한 번만 감소했다.
    expect(getRow(db, 'p1')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    expect(getRow(db, 'p2')?.status).toBe(OUTBOX_STATUS.CANCELLED);
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0);
    expectCounterInvariant(db);
  });
});
