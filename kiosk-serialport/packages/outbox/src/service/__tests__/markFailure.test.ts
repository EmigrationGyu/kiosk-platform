import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ON_DEP_FAIL, OUTBOX_STATUS, type OutboxStatus } from 'kiosk-types';
import { createTestDb, FakeClock } from '../../__test-utils__/test-db';
import type { Db } from '../../db';
import { outboxDependency, outboxMutation } from '../../db';
import { OutboxService } from '../OutboxService';

// ── setup ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;
const INITIAL = 1_000;
const MAX_BACKOFF = 10_000;

type Setup = {
  db: Db;
  clock: FakeClock;
  service: OutboxService;
  cleanup: () => void;
};

/**
 * 기본적으로 random=0.5 (jitter 중앙값) 로 셋업해서 base * 1.0 이 결과로 나오게.
 * jitter 검증 테스트는 별도 setupWithRandom 사용.
 */
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
  pendingDepsCount?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  expiresAt?: number | null;
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
      onDepFail: ON_DEP_FAIL.CANCEL,
      pendingDepsCount: opts.pendingDepsCount ?? 0,
      attempts: opts.attempts ?? 0,
      lastError: opts.lastError ?? null,
      nextAttemptAt: FIXED_NOW,
      initialBackoffMs: opts.initialBackoffMs ?? INITIAL,
      maxBackoffMs: opts.maxBackoffMs ?? MAX_BACKOFF,
      expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
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

describe('OutboxService.markFailure', () => {
  // ── 1. 기본 전이 ────────────────────────────────────────────────────

  describe('기본 전이 (IN_FLIGHT → PENDING with backoff)', () => {
    test('status 가 IN_FLIGHT 에서 PENDING 으로 (재시도 대기)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.IN_FLIGHT });

      await service.markFailure('a', 'network timeout');

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.PENDING);
    });

    test('attempts 가 1 증가', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 0 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.attempts).toBe(1);
    });

    test('lastError 에 전달된 메시지 저장', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a' });

      await service.markFailure('a', 'connection refused');

      expect(getRow(db, 'a')?.lastError).toBe('connection refused');
    });

    test('updatedAt 은 clock.now() 로 갱신', async () => {
      const { service, clock, db } = setup;
      seedRow(db, { id: 'a' });
      clock.set(FIXED_NOW + 5_000);

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.updatedAt).toBe(FIXED_NOW + 5_000);
    });

    test('createdAt 은 변경되지 않음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', createdAt: 100 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.createdAt).toBe(100);
    });
  });

  // ── 2. nextAttemptAt 백오프 계산 (random=0.5 → 1.0x 중앙) ──────────

  describe('지수 백오프 (random=0.5, 1.0x)', () => {
    test('첫 실패 (attempts: 0→1) → now + initial', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 0 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + INITIAL);
    });

    test('두 번째 실패 (attempts: 1→2) → now + 2 × initial', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 1 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + INITIAL * 2);
    });

    test('네 번째 실패 (attempts: 3→4) → now + 8 × initial', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 3 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + INITIAL * 8);
    });

    test('백오프가 maxBackoffMs 를 초과하지 않음 (cap)', async () => {
      const { service, db } = setup;
      // initial=1000, max=10000 → 5번째 실패면 16*1000=16000 → cap 10000
      seedRow(db, { id: 'a', attempts: 4 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + MAX_BACKOFF);
    });

    test('이후 모든 실패도 max 에서 cap 유지', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 10 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + MAX_BACKOFF);
    });
  });

  // ── 3. Jitter ──────────────────────────────────────────────────────

  describe('Jitter (±25%)', () => {
    test('random=0 → 백오프 = base × 0.75', async () => {
      const { db, cleanup } = createTestDb();
      const clock = new FakeClock(FIXED_NOW);
      const service = new OutboxService({
        db,
        clock: clock.now,
        random: () => 0,
      });
      seedRow(db, { id: 'a', attempts: 0 });

      await service.markFailure('a', 'err');

      // base=INITIAL, 0.75x = 750
      expect(getRow(db, 'a')?.nextAttemptAt).toBe(
        FIXED_NOW + Math.floor(INITIAL * 0.75),
      );
      cleanup();
    });

    test('random=0.5 → 백오프 = base × 1.0 (중앙)', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 0 });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.nextAttemptAt).toBe(FIXED_NOW + INITIAL);
    });

    test('random≈1 → 백오프 ≈ base × 1.25 (상한 근사)', async () => {
      const { db, cleanup } = createTestDb();
      const clock = new FakeClock(FIXED_NOW);
      const service = new OutboxService({
        db,
        clock: clock.now,
        random: () => 0.999_999, // upper bound 근사
      });
      seedRow(db, { id: 'a', attempts: 0 });

      await service.markFailure('a', 'err');

      const row = getRow(db, 'a');
      // 0.75 + 0.5 * 0.999999 ≈ 1.2499995 → floor(1000*1.2499995)=1249
      expect(row?.nextAttemptAt).toBeGreaterThanOrEqual(FIXED_NOW + 1240);
      expect(row?.nextAttemptAt).toBeLessThanOrEqual(FIXED_NOW + 1250);
      cleanup();
    });

    test('Jitter 는 maxBackoffMs cap 적용 후에 — cap 된 base 에 jitter', async () => {
      const { db, cleanup } = createTestDb();
      const clock = new FakeClock(FIXED_NOW);
      const service = new OutboxService({
        db,
        clock: clock.now,
        random: () => 0, // 0.75x
      });
      seedRow(db, { id: 'a', attempts: 10 }); // cap 영역

      await service.markFailure('a', 'err');

      // base=MAX_BACKOFF, 0.75x → 7500
      expect(getRow(db, 'a')?.nextAttemptAt).toBe(
        FIXED_NOW + Math.floor(MAX_BACKOFF * 0.75),
      );
      cleanup();
    });
  });

  // ── 4. 스스로 종결시키지 않는다 ────────────────────────────────────

  /**
   * 자동 종결은 기한(expiresAt)만 결정한다. 여기서 횟수로도 끝내면 종료 조건이 둘이 되고,
   * 호출부가 "언제 끝나나"를 두 군데서 읽어야 한다.
   */
  describe('markFailure 는 스스로 종결시키지 않는다', () => {
    test('attempts 가 아무리 쌓여도 PENDING 유지', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 999 });

      await service.markFailure('a', 'err');

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.attempts).toBe(1000);
    });

    test('연속 20회 실패해도 DEAD 로 가지 않는다', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', attempts: 0 });

      for (let i = 0; i < 20; i++) {
        db.update(outboxMutation)
          .set({ status: OUTBOX_STATUS.IN_FLIGHT })
          .where(eq(outboxMutation.id, 'a'))
          .run();
        await service.markFailure('a', `err ${i}`);
      }

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.attempts).toBe(20);
      expect(row?.lastError).toBe('err 19');
    });

    test('후손 cascade 도 일어나지 않는다 — 종결이 아니므로', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', attempts: 999 });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markFailure('p', 'err');

      const child = getRow(db, 'c');
      expect(child?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(child?.pendingDepsCount).toBe(1);
    });
  });

  // ── 5. 멱등성 / 잘못된 상태 호출 ──────────────────────────────────

  describe('멱등성 / 잘못된 상태', () => {
    test('IN_FLIGHT 가 아닌 PENDING 행에 호출 → no-op', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.PENDING,
        attempts: 5,
      });

      await service.markFailure('a', 'err');

      const row = getRow(db, 'a');
      expect(row?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(row?.attempts).toBe(5); // 변화 없음
      expect(row?.lastError).toBeNull();
    });

    test('이미 SUCCESS 인 행에 호출 → no-op', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'a', status: OUTBOX_STATUS.SUCCESS });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.status).toBe(OUTBOX_STATUS.SUCCESS);
    });

    test('이미 DEAD 인 행에 호출 → no-op', async () => {
      const { service, db } = setup;
      seedRow(db, {
        id: 'a',
        status: OUTBOX_STATUS.DEAD,
        attempts: 15,
      });

      await service.markFailure('a', 'err');

      expect(getRow(db, 'a')?.attempts).toBe(15); // 변화 없음
    });

    test('존재하지 않는 id 호출 → throw 안 함, 부수효과 없음', async () => {
      const { service, db } = setup;

      // throw 없이 await 정상 resolve
      await service.markFailure('ghost', 'err');

      const rows = db.select().from(outboxMutation).all();
      expect(rows).toHaveLength(0);
    });
  });

  // ── 6. 자식 영향 없음 (markFailure 단계) ────────────────────────────

  describe('자식 영향 없음 (재시도 예정이므로)', () => {
    test('자식 카운터/상태 변화 없음', async () => {
      const { service, db } = setup;
      seedRow(db, { id: 'p', status: OUTBOX_STATUS.IN_FLIGHT });
      seedRow(db, {
        id: 'c',
        status: OUTBOX_STATUS.PENDING,
        pendingDepsCount: 1,
      });
      seedDep(db, 'p', 'c');

      await service.markFailure('p', 'err');

      const child = getRow(db, 'c');
      expect(child?.pendingDepsCount).toBe(1);
      expect(child?.status).toBe(OUTBOX_STATUS.PENDING);
    });
  });
});
