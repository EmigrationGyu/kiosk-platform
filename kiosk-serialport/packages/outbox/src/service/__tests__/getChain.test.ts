import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
  rootId?: string;
  status?: OutboxStatus;
  type?: string;
  payload?: unknown;
  onDepFail?: OnDepFail;
  attempts?: number;
  pendingDepsCount?: number;
  lastError?: string | null;
  resolutionReason?: string | null;
  nextAttemptAt?: number | null;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  expiresAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
};

function seedRow(db: Db, opts: SeedOpts): void {
  db.insert(outboxMutation)
    .values({
      id: opts.id,
      type: opts.type ?? 'someType',
      payload: opts.payload ?? {},
      status: opts.status ?? OUTBOX_STATUS.PENDING,
      rootId: opts.rootId ?? opts.id,
      onDepFail: opts.onDepFail ?? ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      resolutionReason: opts.resolutionReason ?? null,
      nextAttemptAt: opts.nextAttemptAt ?? FIXED_NOW,
      initialBackoffMs: opts.initialBackoffMs ?? 60_000,
      maxBackoffMs: opts.maxBackoffMs ?? 480_000,
      expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
      createdAt: opts.createdAt ?? FIXED_NOW,
      updatedAt: opts.updatedAt ?? FIXED_NOW,
    })
    .run();
}

function seedDep(db: Db, parentId: string, childId: string): void {
  db.insert(outboxDependency).values({ parentId, childId }).run();
}

let setup: Setup;
beforeEach(() => {
  setup = setupService();
});
afterEach(() => {
  setup.cleanup();
});

// ── 테스트 본체 ────────────────────────────────────────────────────────

describe('OutboxService.getChain', () => {
  // ── 1. 기본 조회 ────────────────────────────────────────────────────

  describe('기본 조회', () => {
    test('rootId 매치되는 단일 행 반환', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', rootId: 'a' });

      const result = await service.getChain({ rootId: 'a' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.id).toBe('a');
    });

    test('rootId 매치되는 여러 행 모두 반환 — createdAt ASC 정렬', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'late', rootId: 'a', createdAt: 300 });
      seedRow(db, { id: 'mid', rootId: 'a', createdAt: 200 });
      seedRow(db, { id: 'early', rootId: 'a', createdAt: 100 });

      const result = await service.getChain({ rootId: 'a' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.map((r) => r.id)).toEqual(['early', 'mid', 'late']);
    });

    test('다른 rootId 의 행은 포함되지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'in-1', rootId: 'A' });
      seedRow(db, { id: 'in-2', rootId: 'A' });
      seedRow(db, { id: 'out-1', rootId: 'B' });

      const result = await service.getChain({ rootId: 'A' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(2);
      const ids = result.data.map((r) => r.id).sort();
      expect(ids).toEqual(['in-1', 'in-2']);
    });
  });

  // ── 2. NOT_FOUND ──────────────────────────────────────────────────

  describe('NOT_FOUND', () => {
    test('존재하지 않는 rootId → NOT_FOUND', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'other', rootId: 'X' });

      const result = await service.getChain({ rootId: 'ghost' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('NOT_FOUND');
      expect(result.code).toBe(OUTBOX_ERROR_CODE.NOT_FOUND);
    });

    test('DB 가 비어있을 때도 NOT_FOUND', async () => {
      const { service } = setup;

      const result = await service.getChain({ rootId: 'any' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.cause).toBe('NOT_FOUND');
    });
  });

  // ── 3. dependsOn 직렬화 ───────────────────────────────────────────

  describe('dependsOn 필드', () => {
    test('의존성 없는 행: 빈 배열', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', rootId: 'a' });

      const result = await service.getChain({ rootId: 'a' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data[0]?.dependsOn).toEqual([]);
    });

    test('의존성 1개', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', rootId: 'p' });
      seedRow(db, { id: 'c', rootId: 'p', pendingDepsCount: 1 });
      seedDep(db, 'p', 'c');

      const result = await service.getChain({ rootId: 'p' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const c = result.data.find((r) => r.id === 'c');
      expect(c?.dependsOn).toEqual(['p']);
      const p = result.data.find((r) => r.id === 'p');
      expect(p?.dependsOn).toEqual([]);
    });

    test('의존성 N개 — id ASC 로 정렬되어 반환 (deterministic)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p1', rootId: 'p1' });
      seedRow(db, { id: 'p2', rootId: 'p1' });
      seedRow(db, { id: 'p3', rootId: 'p1' });
      seedRow(db, {
        id: 'c',
        rootId: 'p1',
        pendingDepsCount: 3,
      });
      // 의도적으로 역순으로 삽입
      seedDep(db, 'p3', 'c');
      seedDep(db, 'p1', 'c');
      seedDep(db, 'p2', 'c');

      const result = await service.getChain({ rootId: 'p1' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const c = result.data.find((r) => r.id === 'c');
      expect(c?.dependsOn).toEqual(['p1', 'p2', 'p3']);
    });
  });

  // ── 4. wire format 정합 ───────────────────────────────────────────

  describe('wire format — 모든 필드 매핑', () => {
    test('모든 칼럼이 반환 행에 포함됨', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        rootId: 'a',
        type: 'createUser',
        payload: { name: 'Alice', age: 30 },
        status: OUTBOX_STATUS.DEAD,
        attempts: 5,
        lastError: 'final error',
        resolutionReason: null,
        nextAttemptAt: 999_000,
        initialBackoffMs: 5_000,
        maxBackoffMs: 60_000,
        expiresAt: 1_800_000_000_000,
        pendingDepsCount: 0,
        onDepFail: ON_DEP_FAIL.PROCEED,
        createdAt: 100,
        updatedAt: 200,
      });

      const result = await service.getChain({ rootId: 'a' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data[0];

      expect(row?.id).toBe('a');
      expect(row?.type).toBe('createUser');
      expect(row?.payload).toEqual({ name: 'Alice', age: 30 });
      expect(row?.status).toBe(OUTBOX_STATUS.DEAD);
      expect(row?.attempts).toBe(5);
      expect(row?.lastError).toBe('final error');
      expect(row?.resolutionReason).toBeNull();
      expect(row?.nextAttemptAt).toBe(999_000);
      expect(row?.initialBackoffMs).toBe(5_000);
      expect(row?.maxBackoffMs).toBe(60_000);
      expect(row?.expiresAt).toBe(1_800_000_000_000);
      expect(row?.pendingDepsCount).toBe(0);
      expect(row?.onDepFail).toBe(ON_DEP_FAIL.PROCEED);
      expect(row?.rootId).toBe('a');
      expect(row?.createdAt).toBe(100);
      expect(row?.updatedAt).toBe(200);
      expect(row?.dependsOn).toEqual([]);
    });

    test('payload 복합 JSON roundtrip', async () => {
      const { service, db } = setup;
      const payload = {
        nested: { a: 1, b: [true, null, 'x'] },
        arr: [{ x: 1 }, { x: 2 }],
      };
      seedRow(db, { id: 'a', rootId: 'a', payload });

      const result = await service.getChain({ rootId: 'a' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data[0]?.payload).toEqual(payload);
    });

    test('expiresAt: null 도 그대로 직렬화 (무기한)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', rootId: 'a', expiresAt: null });

      const result = await service.getChain({ rootId: 'a' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data[0]?.expiresAt).toBeNull();
    });
  });

  // ── 5. status 혼합 ────────────────────────────────────────────────

  describe('status 필터링 없음 — 모든 상태 행 반환', () => {
    test('다양한 status 행 모두 포함 (PENDING/SUCCESS/DEAD/CANCELLED 등)', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'pending',
        rootId: 'r',
        status: OUTBOX_STATUS.PENDING,
        createdAt: 1,
      });
      seedRow(db, {
        id: 'in-flight',
        rootId: 'r',
        status: OUTBOX_STATUS.IN_FLIGHT,
        createdAt: 2,
      });
      seedRow(db, {
        id: 'success',
        rootId: 'r',
        status: OUTBOX_STATUS.SUCCESS,
        createdAt: 3,
      });
      seedRow(db, {
        id: 'dead',
        rootId: 'r',
        status: OUTBOX_STATUS.DEAD,
        createdAt: 4,
      });
      seedRow(db, {
        id: 'cancelled',
        rootId: 'r',
        status: OUTBOX_STATUS.CANCELLED,
        createdAt: 5,
      });
      seedRow(db, {
        id: 'resolved',
        rootId: 'r',
        status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
        createdAt: 6,
      });

      const result = await service.getChain({ rootId: 'r' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(6);
      const ids = result.data.map((r) => r.id);
      expect(ids).toEqual([
        'pending',
        'in-flight',
        'success',
        'dead',
        'cancelled',
        'resolved',
      ]);
    });
  });
});
