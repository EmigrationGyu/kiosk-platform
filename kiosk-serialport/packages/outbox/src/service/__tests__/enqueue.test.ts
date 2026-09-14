import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_RETRY_POLICY,
  type EnqueueRequest,
  ON_DEP_FAIL,
  OUTBOX_ERROR_CODE,
  OUTBOX_STATUS,
  type OutboxStatus,
} from 'kiosk-types';
import { createTestDb, FakeClock } from '../../__test-utils__/test-db';
import type { Db } from '../../db';
import { outboxDependency, outboxMutation } from '../../db';
import { OutboxService } from '../OutboxService';

// ── 테스트 setup ──────────────────────────────────────────────────────────

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

function seedRow(
  db: Db,
  opts: {
    id: string;
    status: OutboxStatus;
    type?: string;
    rootId?: string;
  },
): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: opts.type ?? 'parentType',
      payload: {},
      status: opts.status,
      rootId: opts.rootId ?? opts.id,
      onDepFail: ON_DEP_FAIL.CANCEL,
      pendingDepsCount: 0,
      attempts: 0,
      nextAttemptAt: 0,
      expiresAt: null,
      createdAt: 0,
      updatedAt: 0,
    })
    .run();
}

function makeReq(overrides: Partial<EnqueueRequest> = {}): EnqueueRequest {
  return {
    id: 'k-default',
    type: 'createUser',
    payload: { name: 'Alice' },
    ...overrides,
  };
}

// ── 테스트 본체 ──────────────────────────────────────────────────────────

let setup: Setup;
beforeEach(() => {
  setup = setupService();
});
afterEach(() => {
  setup.cleanup();
});

describe('OutboxService.enqueue', () => {
  // ── 1. 기본 삽입 ────────────────────────────────────────────────────────

  describe('기본 삽입', () => {
    test('의존성 없는 mutation 을 PENDING 으로 삽입', async () => {
      const { service, db } = setup;

      const result = await service.enqueue(makeReq({ id: 'k-1' }));

      expect(result.success).toBe(true);
      if (!result.success) return;

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row).toBeDefined();
      expect(row?.id).toBe('k-1');
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.type).toBe('createUser');
    });

    test('초기 상태: attempts=0, pendingDepsCount=0, error/reason null', async () => {
      const { service, db } = setup;
      const result = await service.enqueue(makeReq({ id: 'k-1' }));
      expect(result.success).toBe(true);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();

      expect(row?.attempts).toBe(0);
      expect(row?.pendingDepsCount).toBe(0);
      expect(row?.lastError).toBeNull();
      expect(row?.resolutionReason).toBeNull();
    });

    test('createdAt / updatedAt 모두 clock.now() 와 동일', async () => {
      const { service, clock, db } = setup;
      clock.set(12345);

      await service.enqueue(makeReq({ id: 'k-1' }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.createdAt).toBe(12345);
      expect(row?.updatedAt).toBe(12345);
    });

    test('nextAttemptAt 은 clock.now() — 의존성 없으면 즉시 픽업 가능', async () => {
      const { service, clock, db } = setup;
      clock.set(99999);

      await service.enqueue(makeReq({ id: 'k-1' }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.nextAttemptAt).toBe(99999);
    });

    test('payload 는 임의 JSON 으로 그대로 저장', async () => {
      const { service, db } = setup;
      const payload = { nested: { a: 1, b: [true, null, 'x'] } };

      await service.enqueue(makeReq({ id: 'k-1', payload }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.payload).toEqual(payload);
    });

    test('deduplicated 는 false (새 행이므로)', async () => {
      const { service } = setup;
      const result = await service.enqueue(makeReq({ id: 'k-1' }));
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.deduplicated).toBe(false);
      expect(result.data.id).toBe('k-1');
    });
  });

  // ── 1.5 retryPolicy ────────────────────────────────────────────────────

  describe('retryPolicy', () => {
    test('미지정 시 기본값 (1m / 8m)', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1' }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.initialBackoffMs).toBe(
        DEFAULT_RETRY_POLICY.INITIAL_BACKOFF_MS,
      );
      expect(row?.maxBackoffMs).toBe(DEFAULT_RETRY_POLICY.MAX_BACKOFF_MS);
    });

    test('명시 지정 시 그 값으로 저장', async () => {
      const { service, db } = setup;
      await service.enqueue(
        makeReq({
          id: 'k-1',
          retryPolicy: { initialBackoffMs: 5_000, maxBackoffMs: 60_000 },
        }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.initialBackoffMs).toBe(5_000);
      expect(row?.maxBackoffMs).toBe(60_000);
    });

    test('일부 필드만 지정 시 나머지는 기본값', async () => {
      const { service, db } = setup;
      await service.enqueue(
        makeReq({ id: 'k-1', retryPolicy: { initialBackoffMs: 5_000 } }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.initialBackoffMs).toBe(5_000);
      expect(row?.maxBackoffMs).toBe(DEFAULT_RETRY_POLICY.MAX_BACKOFF_MS);
    });
  });

  // ── 1-b. expiresAt — 자동 종결의 유일한 축 ─────────────────────────────

  describe('expiresAt', () => {
    test('미지정 시 now + DEFAULT_EXPIRY_MS', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1' }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.expiresAt).toBe(
        FIXED_NOW + DEFAULT_RETRY_POLICY.DEFAULT_EXPIRY_MS,
      );
    });

    test('명시 지정 시 그 절대 시각으로 저장 — 도메인 앵커에서 온 값', async () => {
      const { service, db } = setup;
      const checkOutAt = FIXED_NOW + 6 * 60 * 60_000;
      await service.enqueue(makeReq({ id: 'k-1', expiresAt: checkOutAt }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.expiresAt).toBe(checkOutAt);
    });

    test('null → 무기한. 기본값으로 덮이지 않는다', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1', expiresAt: null }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.expiresAt).toBeNull();
    });

    test('이미 지난 기한도 그대로 받는다 — 만료 판정은 스윕의 몫', async () => {
      const { service, db } = setup;
      const past = FIXED_NOW - 1_000;
      await service.enqueue(makeReq({ id: 'k-1', expiresAt: past }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.expiresAt).toBe(past);
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });

  // ── 2. onDepFail ───────────────────────────────────────────────────────

  describe('onDepFail', () => {
    test('미지정 시 기본값 CANCEL', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1' }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.onDepFail).toBe(ON_DEP_FAIL.CANCEL);
    });

    test('명시적 PROCEED 적용', async () => {
      const { service, db } = setup;
      await service.enqueue(
        makeReq({ id: 'k-1', onDepFail: ON_DEP_FAIL.PROCEED }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.onDepFail).toBe(ON_DEP_FAIL.PROCEED);
    });
  });

  // ── 3. rootId ───────────────────────────────────────────────────────────

  describe('rootId', () => {
    test('미지정 시 체인 시작점 — rootId === id', async () => {
      const { service, db } = setup;
      const result = await service.enqueue(makeReq({ id: 'k-1' }));
      expect(result.success).toBe(true);
      if (!result.success) return;

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.rootId).toBe('k-1');
      expect(result.data.rootId).toBe('k-1');
    });

    test('명시적으로 지정한 rootId 가 그대로 저장됨 (체인 연결)', async () => {
      const { service, db } = setup;
      const result = await service.enqueue(
        makeReq({ id: 'k-1', rootId: 'chain-root-xyz' }),
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.rootId).toBe('chain-root-xyz');
      expect(result.data.rootId).toBe('chain-root-xyz');
    });
  });

  // ── 4. id 중복 — dedup (같은 type) ─────────────────────────────────────

  describe('id 중복 — 같은 type (dedup)', () => {
    test('같은 id + 같은 type 재호출 시 deduplicated=true 반환', async () => {
      const { service } = setup;
      const first = await service.enqueue(makeReq({ id: 'k-1' }));
      expect(first.success).toBe(true);

      const second = await service.enqueue(makeReq({ id: 'k-1' }));
      expect(second.success).toBe(true);
      if (!second.success) return;

      expect(second.data.id).toBe('k-1');
      expect(second.data.deduplicated).toBe(true);
    });

    test('dedup 시 새 행을 생성하지 않음 (총 1행)', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1' }));
      await service.enqueue(makeReq({ id: 'k-1' }));

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(1);
    });

    test('dedup 시 두 번째 호출의 payload 변경은 무시 (first-write-wins)', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1', payload: { v: 1 } }));
      await service.enqueue(makeReq({ id: 'k-1', payload: { v: 2 } }));

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toEqual({ v: 1 });
    });

    test('이미 종결된 행(CANCELLED)에 대한 재enqueue 도 dedup — 상태 변경 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.CANCELLED });
      // p1 의존 + onDepFail=CANCEL → k-1 이 즉시 CANCELLED 로 삽입된다는 가정
      await service.enqueue(
        makeReq({
          id: 'k-1',
          type: 'A',
          dependsOn: ['p1'],
          onDepFail: ON_DEP_FAIL.CANCEL,
        }),
      );

      const second = await service.enqueue(makeReq({ id: 'k-1', type: 'A' }));
      expect(second.success).toBe(true);
      if (!second.success) return;
      expect(second.data.deduplicated).toBe(true);

      // 상태는 CANCELLED 그대로 — re-enqueue 가 부활시키지 않음.
      // 부활은 retry / resolve 엔드포인트의 책임.
      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });
  });

  // ── 5. id 중복 — 다른 type (충돌, 실패는 값으로) ────────────────────

  describe('id 중복 — 다른 type (ID_TYPE_MISMATCH)', () => {
    test('실패는 throw 가 아닌 Result 값으로 반환됨', async () => {
      const { service } = setup;
      await service.enqueue(makeReq({ id: 'k-1', type: 'A' }));

      // 절대 throw 하지 않아야 함 — 값으로만 받음
      const second = await service.enqueue(makeReq({ id: 'k-1', type: 'B' }));
      expect(second.success).toBe(false);
    });

    test('cause / code 가 ID_TYPE_MISMATCH 로 정확히 채워짐', async () => {
      const { service } = setup;
      await service.enqueue(makeReq({ id: 'k-1', type: 'A' }));

      const second = await service.enqueue(makeReq({ id: 'k-1', type: 'B' }));
      expect(second.success).toBe(false);
      if (second.success) return;
      expect(second.cause).toBe('ID_TYPE_MISMATCH');
      expect(second.code).toBe(OUTBOX_ERROR_CODE.ID_TYPE_MISMATCH);
    });

    test('충돌 시 새 행을 생성하지 않음 — 첫 호출의 행만 살아있음', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'k-1', type: 'A' }));
      await service.enqueue(makeReq({ id: 'k-1', type: 'B' }));

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe('A');
    });

    test('충돌 시 기존 행의 type/payload/status 가 변경되지 않음 (immutability)', async () => {
      const { service, db } = setup;
      await service.enqueue(
        makeReq({ id: 'k-1', type: 'A', payload: { keep: 'me' } }),
      );

      await service.enqueue(
        makeReq({ id: 'k-1', type: 'B', payload: { override: 'attempt' } }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.type).toBe('A');
      expect(row?.payload).toEqual({ keep: 'me' });
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('이미 종결된(SUCCESS) 행과의 type 충돌도 동일하게 ID_TYPE_MISMATCH', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'k-1', status: OUTBOX_STATUS.SUCCESS, type: 'A' });

      const second = await service.enqueue(makeReq({ id: 'k-1', type: 'B' }));
      expect(second.success).toBe(false);
      if (second.success) return;
      expect(second.cause).toBe('ID_TYPE_MISMATCH');
    });
  });

  // ── 6. dependsOn — 일반 케이스 ─────────────────────────────────────────

  describe('dependsOn', () => {
    test('미지정 = 빈 배열과 동일 (pendingDepsCount=0)', async () => {
      const { service, db } = setup;
      await service.enqueue(makeReq({ id: 'a' }));
      await service.enqueue(makeReq({ id: 'b', dependsOn: [] }));

      const rows = db.select().from(outboxMutation).all();
      for (const r of rows) {
        expect(r.pendingDepsCount).toBe(0);
      }
    });

    test('존재하지 않는 부모 id → 실패는 값으로 (DEPENDENCY_NOT_FOUND)', async () => {
      const { service, db } = setup;

      const result = await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['ghost-id'] }),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('DEPENDENCY_NOT_FOUND');
      expect(result.code).toBe(OUTBOX_ERROR_CODE.DEPENDENCY_NOT_FOUND);

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(0);
    });

    test('일부만 존재하지 않아도 DEPENDENCY_NOT_FOUND', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });

      const result = await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['p1', 'ghost'] }),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('DEPENDENCY_NOT_FOUND');

      // 부모 1개만 살아있고 새 행은 안 들어감
      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('p1');
    });

    test('모든 부모가 ghost → DEPENDENCY_NOT_FOUND, 부수효과 없음', async () => {
      const { service, db } = setup;

      const result = await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['ghost-a', 'ghost-b', 'ghost-c'] }),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('DEPENDENCY_NOT_FOUND');

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(0);
    });

    test('자기 자신을 dependsOn 에 포함하면 DEPENDENCY_NOT_FOUND (forward-only edge 자연 방지)', async () => {
      const { service, db } = setup;

      const result = await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['k-1'] }),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      // 자기 자신 id 는 enqueue 시점에 아직 DB 에 없으므로 미존재로 판정됨
      expect(result.cause).toBe('DEPENDENCY_NOT_FOUND');

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(0);
    });

    test('DEPENDENCY_NOT_FOUND 시 outbox_dependency 테이블도 깨끗 (atomic rollback)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });

      // 정상 부모 p1, p2 + ghost 하나라도 끼면 전체 실패 → dep 행 0개여야 함
      await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['p1', 'p2', 'ghost'] }),
      );

      const deps = db.select().from(outboxDependency).all();
      expect(deps).toHaveLength(0);
    });

    test('PENDING 부모 1개 → pendingDepsCount=1', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });

      await service.enqueue(makeReq({ id: 'k-1', dependsOn: ['p1'] }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.pendingDepsCount).toBe(1);
    });

    test('PENDING 부모 N개 → pendingDepsCount=N', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'p3', status: OUTBOX_STATUS.PENDING });

      await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['p1', 'p2', 'p3'] }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.pendingDepsCount).toBe(3);
    });

    test('SUCCESS 부모는 카운트하지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.SUCCESS });

      await service.enqueue(makeReq({ id: 'k-1', dependsOn: ['p1'] }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.pendingDepsCount).toBe(0);
    });

    test('RESOLVED_EXTERNAL 부모는 카운트하지 않음 (외부 완료도 종결-성공)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.RESOLVED_EXTERNAL });

      await service.enqueue(makeReq({ id: 'k-1', dependsOn: ['p1'] }));

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.pendingDepsCount).toBe(0);
    });

    test('PENDING + SUCCESS 혼합 → 미완료만 카운트', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.SUCCESS });
      seedRow(db, { id: 'p3', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'p4', status: OUTBOX_STATUS.RESOLVED_EXTERNAL });

      await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['p1', 'p2', 'p3', 'p4'] }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.pendingDepsCount).toBe(2);
    });

    test('outbox_dependency 조인 테이블에 모든 (parent, child) 행 삽입', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });

      await service.enqueue(makeReq({ id: 'k-1', dependsOn: ['p1', 'p2'] }));

      const deps = db
        .select()
        .from(outboxDependency)
        .where(eq(outboxDependency.childId, 'k-1'))
        .all();
      const parents = deps.map((d) => d.parentId).sort();
      expect(parents).toEqual(['p1', 'p2']);
    });

    test('중복 부모 id 는 dedupe — dependency 행은 한 번만 삽입', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.PENDING });

      await service.enqueue(
        makeReq({ id: 'k-1', dependsOn: ['p1', 'p1', 'p1'] }),
      );

      const deps = db
        .select()
        .from(outboxDependency)
        .where(eq(outboxDependency.childId, 'k-1'))
        .all();
      expect(deps).toHaveLength(1);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.pendingDepsCount).toBe(1);
    });
  });

  // ── 7. 부모가 종결-실패 상태 (CANCELLED / DEAD) ────────────────────────

  describe('부모가 종결-실패 상태일 때', () => {
    test('CANCELLED 부모 + onDepFail=CANCEL → 새 행이 즉시 CANCELLED 로 삽입', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.CANCELLED });

      const result = await service.enqueue(
        makeReq({
          id: 'k-1',
          dependsOn: ['p1'],
          onDepFail: ON_DEP_FAIL.CANCEL,
        }),
      );
      expect(result.success).toBe(true);

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('DEAD 부모 + onDepFail=CANCEL → 새 행이 즉시 CANCELLED', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.DEAD });

      await service.enqueue(
        makeReq({
          id: 'k-1',
          dependsOn: ['p1'],
          onDepFail: ON_DEP_FAIL.CANCEL,
        }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.CANCELLED);
    });

    test('CANCELLED 부모 + onDepFail=PROCEED → 새 행 PENDING, 그 부모는 카운트 제외', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', status: OUTBOX_STATUS.CANCELLED });
      seedRow(db, { id: 'p2', status: OUTBOX_STATUS.PENDING });

      await service.enqueue(
        makeReq({
          id: 'k-1',
          dependsOn: ['p1', 'p2'],
          onDepFail: ON_DEP_FAIL.PROCEED,
        }),
      );

      const row = db
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, 'k-1'))
        .get();
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.pendingDepsCount).toBe(1); // p1 무시, p2만 카운트
    });
  });

  // ── 8. 실패가 값으로 흐른다는 사실을 명시하는 메타 테스트 ─────────────

  describe('실패는 값(Result.success=false)으로 반환 — throw 금지', () => {
    test('어떤 enqueue 호출도 throw 하지 않아야 함', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p-ok', status: OUTBOX_STATUS.PENDING });
      await service.enqueue(makeReq({ id: 'k-1', type: 'A' }));

      // 다양한 실패 시나리오 — 전부 await 표현식이 정상적으로 resolve 해야 함
      const cases = [
        // ID_TYPE_MISMATCH
        () => service.enqueue(makeReq({ id: 'k-1', type: 'B' })),
        // DEPENDENCY_NOT_FOUND
        () => service.enqueue(makeReq({ id: 'k-2', dependsOn: ['ghost'] })),
      ];

      for (const fn of cases) {
        const r = await fn(); // throw 시 테스트 실패
        expect(r.success).toBe(false);
      }

      // 정상 enqueue 도 잘 되는지
      const ok = await service.enqueue(
        makeReq({ id: 'k-3', dependsOn: ['p-ok'] }),
      );
      expect(ok.success).toBe(true);

      // 실패 케이스로 인한 부수효과 없음 검증 — k-1, p-ok, k-3 만 존재
      const rows = db.select().from(outboxMutation).all();
      const ids = rows.map((r) => r.id).sort();
      expect(ids).toEqual(['k-1', 'k-3', 'p-ok']);
    });
  });
});
