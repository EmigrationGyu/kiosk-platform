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
 * supersede — "같은 자리의 더 새 값이 옛 값을 폐기한다".
 *
 * 절대값 set(카드키 매수)은 순서가 뒤집히면 옛 값이 최신을 되돌린다. 역전을 막는 대신
 * 낡은 의도를 닫는다: 큐 안은 enqueue 가(supersedeKey 동일 행 폐기), 큐 밖 직접 성공은
 * SUPERSEDE 엔드포인트가.
 */

const FIXED_NOW = 1_700_000_000_000;
const SCOPE = 'set-key-counts:res-1:issued';

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
  supersedeKey?: string | null;
  onDepFail?: OnDepFail;
  pendingDepsCount?: number;
  resolutionReason?: string | null;
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
      resolutionReason: opts.resolutionReason ?? null,
      nextAttemptAt: FIXED_NOW,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      expiresAt: null,
      supersedeKey: opts.supersedeKey ?? null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .run();
}

const getRow = (db: Db, id: string) =>
  db.select().from(outboxMutation).where(eq(outboxMutation.id, id)).get();

let setup: Setup;
beforeEach(() => {
  setup = setupService();
});
afterEach(() => {
  setup.cleanup();
});

// ── SUPERSEDE 엔드포인트 ──────────────────────────────────────────────────

describe('supersede 엔드포인트', () => {
  test('다시 나갈 수 있는 상태(PENDING/IN_FLIGHT/DEAD/CANCELLED)를 전부 닫는다', async () => {
    const { service, db } = setup;
    seedRow(db, {
      id: 'a',
      status: OUTBOX_STATUS.PENDING,
      supersedeKey: SCOPE,
    });
    seedRow(db, {
      id: 'b',
      status: OUTBOX_STATUS.IN_FLIGHT,
      supersedeKey: SCOPE,
    });
    seedRow(db, { id: 'c', status: OUTBOX_STATUS.DEAD, supersedeKey: SCOPE });
    seedRow(db, {
      id: 'd',
      status: OUTBOX_STATUS.CANCELLED,
      supersedeKey: SCOPE,
    });

    const result = await service.supersede({
      supersedeKey: SCOPE,
      reason: 'superseded by direct success',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.superseded).toBe(4);
    for (const id of ['a', 'b', 'c', 'd']) {
      const row = getRow(db, id);
      expect(row?.status).toBe(OUTBOX_STATUS.SUPERSEDED);
      expect(row?.resolutionReason).toBe('superseded by direct success');
    }
  });

  test('종결-성공·EXPIRED·SUPERSEDED 는 건드리지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, {
      id: 's',
      status: OUTBOX_STATUS.SUCCESS,
      supersedeKey: SCOPE,
    });
    seedRow(db, {
      id: 'r',
      status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
      supersedeKey: SCOPE,
    });
    // EXPIRED: 이미 부활 불가 — "시효가 지났다"는 사실을 덮을 이유가 없다.
    seedRow(db, {
      id: 'e',
      status: OUTBOX_STATUS.EXPIRED,
      supersedeKey: SCOPE,
      resolutionReason: 'expired at ...',
    });
    seedRow(db, {
      id: 'p',
      status: OUTBOX_STATUS.SUPERSEDED,
      supersedeKey: SCOPE,
      resolutionReason: 'superseded earlier',
    });

    const result = await service.supersede({
      supersedeKey: SCOPE,
      reason: 'r',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.superseded).toBe(0);
    expect(getRow(db, 's')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    expect(getRow(db, 'r')?.status).toBe(OUTBOX_STATUS.RESOLVED_EXTERNAL);
    expect(getRow(db, 'e')?.status).toBe(OUTBOX_STATUS.EXPIRED);
    expect(getRow(db, 'e')?.resolutionReason).toBe('expired at ...');
    expect(getRow(db, 'p')?.resolutionReason).toBe('superseded earlier');
  });

  test('다른 자리(supersedeKey)와 무관 행(null)은 건드리지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, {
      id: 'other',
      supersedeKey: 'set-key-counts:res-1:returned',
    });
    seedRow(db, { id: 'none', supersedeKey: null });

    const result = await service.supersede({
      supersedeKey: SCOPE,
      reason: 'r',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.superseded).toBe(0);
    expect(getRow(db, 'other')?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(getRow(db, 'none')?.status).toBe(OUTBOX_STATUS.PENDING);
  });

  test('매치 0건도 성공 — 큐가 비어 있는 것이 정상 상태다', async () => {
    const { service } = setup;

    const result = await service.supersede({
      supersedeKey: SCOPE,
      reason: 'r',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.superseded).toBe(0);
  });
});

// ── enqueue 통합 ─────────────────────────────────────────────────────────

describe('enqueue 의 supersedeKey', () => {
  test('같은 자리의 옛 PENDING 행을 닫고 새 행을 삽입한다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'old-3', supersedeKey: SCOPE });

    const result = await service.enqueue({
      id: 'new-4',
      type: 'someType',
      payload: { query: 'mutation X' },
      supersedeKey: SCOPE,
    });

    expect(result.success).toBe(true);
    expect(getRow(db, 'old-3')?.status).toBe(OUTBOX_STATUS.SUPERSEDED);
    expect(getRow(db, 'old-3')?.resolutionReason).toBe(
      'superseded by newer enqueue: new-4',
    );
    const inserted = getRow(db, 'new-4');
    expect(inserted?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(inserted?.supersedeKey).toBe(SCOPE);
  });

  test('supersedeKey 없는 enqueue 는 아무것도 닫지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'old', supersedeKey: SCOPE });

    await service.enqueue({
      id: 'new',
      type: 'someType',
      payload: { query: 'mutation X' },
    });

    expect(getRow(db, 'old')?.status).toBe(OUTBOX_STATUS.PENDING);
  });

  test('dedup 이 먼저다 — 같은 id 재enqueue 는 supersede 를 일으키지 않는다', async () => {
    const { service, db } = setup;
    seedRow(db, {
      id: 'k-1',
      status: OUTBOX_STATUS.SUPERSEDED,
      supersedeKey: SCOPE,
    });
    seedRow(db, { id: 'k-2', supersedeKey: SCOPE });

    // k-1 재보고 — 이미 더 새 값(k-2)이 있어 폐기된 값이다. dedup 으로 흡수되고
    // k-2(살아있는 최신 값)는 건드리지 않는다.
    const result = await service.enqueue({
      id: 'k-1',
      type: 'someType',
      payload: { query: 'mutation X' },
      supersedeKey: SCOPE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.deduplicated).toBe(true);
    expect(getRow(db, 'k-1')?.status).toBe(OUTBOX_STATUS.SUPERSEDED);
    expect(getRow(db, 'k-2')?.status).toBe(OUTBOX_STATUS.PENDING);
  });
});

// ── 종결 의미론 ──────────────────────────────────────────────────────────

describe('SUPERSEDED 의 종결 의미론', () => {
  test('retry 거부 — 낡은 절대값의 부활이 정확히 막으려는 버그다', async () => {
    const { service, db } = setup;
    seedRow(db, {
      id: 'a',
      status: OUTBOX_STATUS.SUPERSEDED,
      supersedeKey: SCOPE,
    });

    const result = await service.retry({ id: 'a' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.cause).toBe('INVALID_STATE_TRANSITION');
    expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUPERSEDED);
  });

  test('IN_FLIGHT 를 닫은 뒤 돌아온 verdict 는 no-op — SUPERSEDED 가 유지된다', async () => {
    const { service, db } = setup;
    seedRow(db, {
      id: 'a',
      status: OUTBOX_STATUS.IN_FLIGHT,
      supersedeKey: SCOPE,
    });

    await service.supersede({ supersedeKey: SCOPE, reason: 'r' });
    await service.markSuccess('a'); // 발사 중이던 옛 값이 뒤늦게 성공 응답을 받아도

    expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUPERSEDED);
  });

  test('비종결 행을 닫으면 CANCEL 자식이 cascade 된다', async () => {
    const { service, db } = setup;
    seedRow(db, { id: 'p', supersedeKey: SCOPE });
    seedRow(db, { id: 'c', pendingDepsCount: 1 });
    db.insert(outboxDependency).values({ parentId: 'p', childId: 'c' }).run();

    await service.supersede({ supersedeKey: SCOPE, reason: 'r' });

    const c = getRow(db, 'c');
    expect(c?.status).toBe(OUTBOX_STATUS.CANCELLED);
    expect(c?.pendingDepsCount).toBe(1); // 엣지 미정산 — cascade 규약 그대로
  });

  test('이미 DEAD 였던 행을 닫아도 cascade 를 다시 돌리지 않는다 (이중 감소 방지)', async () => {
    const { service, db } = setup;
    // p 가 DEAD 가 될 때 PROCEED 자식 c 는 이미 정산(1→0)된 상태를 재현
    seedRow(db, { id: 'p', status: OUTBOX_STATUS.DEAD, supersedeKey: SCOPE });
    seedRow(db, {
      id: 'c',
      onDepFail: ON_DEP_FAIL.PROCEED,
      pendingDepsCount: 0,
    });
    db.insert(outboxDependency)
      .values({ parentId: 'p', childId: 'c', settled: true })
      .run();

    await service.supersede({ supersedeKey: SCOPE, reason: 'r' });

    expect(getRow(db, 'p')?.status).toBe(OUTBOX_STATUS.SUPERSEDED);
    expect(getRow(db, 'c')?.pendingDepsCount).toBe(0); // 그대로
    expect(getRow(db, 'c')?.status).toBe(OUTBOX_STATUS.PENDING);
  });
});
