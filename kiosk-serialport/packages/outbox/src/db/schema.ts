import { type InferInsertModel, type InferSelectModel, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import {
  ON_DEP_FAIL,
  type OnDepFail,
  OUTBOX_STATUS,
  type OutboxStatus,
} from 'kiosk-types';

const STATUS_VALUES = Object.values(OUTBOX_STATUS) as [
  OutboxStatus,
  ...OutboxStatus[],
];

const ON_DEP_FAIL_VALUES = Object.values(ON_DEP_FAIL) as [
  OnDepFail,
  ...OnDepFail[],
];

/**
 * outbox 에 등록된 mutation 한 건. `id` 는 호출부의 `defineMutation.idempotencyKey(input)` 가 도출한
 * 키로, 행 PK 겸 서버 멱등성 토큰으로 양쪽에서 같이 쓴다. 시간은 모두 unix epoch ms 이고, dependsOn
 * 관계는 별도 조인 테이블에 둔다(`pendingDepsCount` 는 의존성 만족을 O(1)로 판정하는 카운터).
 */
export const outboxMutation = sqliteTable(
  'outbox_mutation',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),

    /** type별 스키마는 호출부 defineMutation 레지스트리에서 별도 검증. */
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),

    status: text('status', { enum: STATUS_VALUES }).notNull(),

    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),

    /**
     * 다음 재시도 시각 (unix ms). 픽업이 `next_attempt_at <= now` 로 거르므로 NULL 이면
     * SQL 상 영원히 안 잡힌다 — "즉시" 는 NULL 이 아니라 now 로 적는다.
     */
    nextAttemptAt: integer('next_attempt_at').notNull(),

    /** 미완료 의존성 개수. 0이면 ready. */
    pendingDepsCount: integer('pending_deps_count').notNull().default(0),

    onDepFail: text('on_dep_fail', { enum: ON_DEP_FAIL_VALUES })
      .notNull()
      .default('CANCEL'),

    /** 비즈니스 트랜잭션 체인 추적용 correlation id. 체인 시작점에선 자기 자신 id. */
    rootId: text('root_id').notNull(),

    /** resolve / cancel 액션 시 운영자 사유. */
    resolutionReason: text('resolution_reason'),

    /** 백오프 곡선 — enqueue 시점 스냅샷. 정책을 바꿔도 기존 행은 영향받지 않는다. */
    initialBackoffMs: integer('initial_backoff_ms').notNull().default(60_000),
    maxBackoffMs: integer('max_backoff_ms').notNull().default(480_000),

    /**
     * 이 작업이 유효한 마지막 시각 (unix ms). 지나면 EXPIRED — 자동 종료의 유일한 축.
     * null = 무기한. 호출부가 도메인 앵커에서 도출한다.
     */
    expiresAt: integer('expires_at'),

    /**
     * 같은 자리의 좌표 (예: `set-key-counts:{reservationId}:issued`). 더 새 값이 확정되면 같은 키의 옛
     * 행이 SUPERSEDED 로 닫힌다. null = supersede 무관(대부분의 전략).
     */
    supersedeKey: text('supersede_key'),

    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdate(() => Date.now()),
  },
  (t) => [
    /** 픽업 쿼리 핵심 인덱스: status + 의존성 + 타이머. */
    index('idx_outbox_picker').on(
      t.status,
      t.pendingDepsCount,
      t.nextAttemptAt,
    ),
    /** 체인 조회 (GET_CHAIN). */
    index('idx_outbox_root').on(t.rootId),
    /** 만료 스윕: 매 tick 마다 도는 쿼리라 픽업 인덱스와 따로 둔다. */
    index('idx_outbox_expiry').on(t.status, t.expiresAt),
    /** supersede 조회: 같은 자리의 옛 행 스캔. */
    index('idx_outbox_supersede').on(t.supersedeKey),

    check('chk_outbox_attempts_nonneg', sql`${t.attempts} >= 0`),
    check('chk_outbox_pending_deps_nonneg', sql`${t.pendingDepsCount} >= 0`),
  ],
);

/**
 * mutation 간 의존 관계 (parent → child). forward-only edge — child 는 enqueue 시점에 이미 존재하는
 * parent 만 참조할 수 있어 사이클이 자연 방지되고 별도 검증이 필요 없다.
 */
export const outboxDependency = sqliteTable(
  'outbox_dependency',
  {
    parentId: text('parent_id')
      .notNull()
      .references(() => outboxMutation.id, { onDelete: 'cascade' }),
    childId: text('child_id')
      .notNull()
      .references(() => outboxMutation.id, { onDelete: 'cascade' }),
    /**
     * 이 엣지가 자식 카운터에서 이미 빠졌는가. 불변식: `child.pendingDepsCount` = 그 자식의
     * 미정산(settled=0) 엣지 수.
     *
     * 감소 신호를 보내는 곳이 셋(markSuccess / 종결-실패 cascade 의 PROCEED / resolve)이라, 부모
     * status 에서 역산하면 DEAD→cancel→resolve 경로에서 이력이 지워져 이중 감소가 난다. 감소와 정산
     * 마킹을 한 트랜잭션에 묶어 엣지당 정확히 1회를 데이터로 강제한다.
     */
    settled: integer('settled', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.parentId, t.childId] }),
    /** 자식으로부터 부모 역추적 (의존성 카운트 재계산 등). */
    index('idx_outbox_dep_child').on(t.childId),
    /** 자기 자신 참조 금지 — DAG 안전망. */
    check('chk_outbox_dep_no_self', sql`${t.parentId} != ${t.childId}`),
  ],
);

export type OutboxMutationRow = InferSelectModel<typeof outboxMutation>;
export type OutboxMutationInsert = InferInsertModel<typeof outboxMutation>;
export type OutboxDependencyRow = InferSelectModel<typeof outboxDependency>;
export type OutboxDependencyInsert = InferInsertModel<typeof outboxDependency>;
