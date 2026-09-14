import { z } from 'zod';
import {
  type Result,
  type ResultVoid,
  resultSchemaOf,
  resultVoidSchemaOf,
} from '../result';
import {
  CASCADE_POLICY,
  type CascadePolicy,
  ON_DEP_FAIL,
  type OnDepFail,
  OUTBOX_ERROR_CODE,
  OUTBOX_STATUS,
  type OutboxCause,
  type OutboxStatus,
} from '../types/outbox';

export const OUTBOX_EVENTS = {
  /** mutation을 큐에 추가. idempotencyKey 중복 시 기존 행 id 반환 (중복 enqueue 안전). */
  ENQUEUE: '/enqueue',
  /** 즉시 재시도 트리거 (네트워크 복구 / 부팅 직후). */
  DRAIN: '/drain',
  /** 체인 전체 스냅샷 조회. */
  GET_CHAIN: '/get_chain',
  /** DEAD → PENDING. cascade로 CANCELLED 후손도 함께 깨울 수 있음. */
  RETRY: '/retry',
  /** 외부 경로로 완료 처리. RESOLVED_EXTERNAL 으로 종결. */
  RESOLVE: '/resolve',
  /** 비즈니스 작업 자체 폐기. 후손 항상 cascade. */
  CANCEL: '/cancel',
  /**
   * 같은 자리(supersedeKey)의 옛 행들을 SUPERSEDED 로 닫는다. 절대값 set 은 순서가 뒤집히면 옛 값이
   * 최신을 되돌리므로, 더 새 값이 **직접 호출로** 성공한 순간 프론트가 이걸 쏜다(fire-and-forget).
   * 큐 안에서의 역전은 enqueue 가 supersedeKey 로 스스로 닫는다.
   */
  SUPERSEDE: '/supersede',
  /**
   * 원격에 말을 걸 자격(엔드포인트·토큰)을 넘긴다. 백엔드가 부팅 때와 토큰이 갈릴 때 보낸다.
   * outbox 는 메모리에만 두므로 재기동하면 비어 있고, 그동안은 실패가 아니라 묻지 않는다(deferred).
   */
  SET_CREDENTIALS: '/set_credentials',
} as const;

// ── Enum schemas ─────────────────────────────────────────────────────────────

const OutboxStatusSchema = z.enum(
  Object.values(OUTBOX_STATUS) as [OutboxStatus, ...OutboxStatus[]],
);

const OnDepFailSchema = z.enum(
  Object.values(ON_DEP_FAIL) as [OnDepFail, ...OnDepFail[]],
);

const CascadePolicySchema = z.enum(
  Object.values(CASCADE_POLICY) as [CascadePolicy, ...CascadePolicy[]],
);

const OutboxCauseSchema = z.enum(
  Object.keys(OUTBOX_ERROR_CODE) as [OutboxCause, ...OutboxCause[]],
);

// ── Mutation record (조회 응답에 공통으로 쓰임) ──────────────────────────────

/**
 * Outbox 에 저장된 mutation 행의 wire format. `id` 는 호출부가 `defineMutation.idempotencyKey(input)`
 * 로 도출한 키 — 행 PK 겸 서버 멱등성 토큰으로 양쪽에 쓴다. Date 필드는 unix epoch ms,
 * payload 는 type별 스키마가 호출부 `defineMutation` 에서 별도 검증한다.
 */
export const OutboxMutationSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.unknown(),
  status: OutboxStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  /** "즉시" 는 NULL 이 아니라 now 로 적는다 — 픽업이 `<= now` 로 거르므로 notNull. */
  nextAttemptAt: z.number().int(),
  dependsOn: z.array(z.string()),
  /** 같은 자리의 더 새 값이 이 행을 대체할 수 있는 좌표. null = supersede 무관. */
  supersedeKey: z.string().nullable(),
  pendingDepsCount: z.number().int().nonnegative(),
  onDepFail: OnDepFailSchema,
  rootId: z.string(),
  resolutionReason: z.string().nullable(),
  /** 재시도 정책 — enqueue 시점에 행에 박힘. 정책 변경은 새 행에만 반영. */
  initialBackoffMs: z.number().int().positive(),
  maxBackoffMs: z.number().int().positive(),
  /**
   * 이 작업이 유효한 마지막 시각 (unix ms). 지나면 EXPIRED — 자동 종료의 유일한 축이다.
   * null = 무기한(운영자가 cancel/resolve 할 때까지).
   */
  expiresAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type OutboxMutationRecord = z.infer<typeof OutboxMutationSchema>;

// ── Request schemas ──────────────────────────────────────────────────────────

/**
 * 백오프 곡선만 정한다. 모든 필드 optional — 미지정 시 DEFAULT_RETRY_POLICY 사용.
 * 언제까지 재시도할지는 정책이 아니라 도메인이 답하므로 `expiresAt` 이 따로 진다.
 */
const RetryPolicySchema = z.object({
  initialBackoffMs: z.number().int().positive().optional(),
  maxBackoffMs: z.number().int().positive().optional(),
});

const EnqueueRequestSchema = z.object({
  /** 행 PK 겸 서버 멱등성 토큰 — 호출부 `defineMutation.idempotencyKey(input)` 가 도출한 값. */
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
  dependsOn: z.array(z.string()).optional(),
  onDepFail: OnDepFailSchema.optional(),
  /** 미지정 시 id 와 동일하게 세팅됨 (체인 시작점). */
  rootId: z.string().optional(),
  /** `defineMutation.retryPolicy` 가 derive한 백오프 곡선. 미지정 시 기본값. */
  retryPolicy: RetryPolicySchema.optional(),
  /**
   * 이 작업이 유효한 마지막 시각 (unix ms) — 도메인 앵커에서 도출한다(요금 청구는
   * `reservation.useExpireAt` 등). 미지정 = DEFAULT_EXPIRY_MS 후, `null` = 무기한(명시적 선택).
   */
  expiresAt: z.number().int().nullable().optional(),
  /**
   * 같은 자리의 좌표 (예: `set-key-counts:{reservationId}:issued`). 지정하면 enqueue 가 같은 키의 옛
   * 행들을 SUPERSEDED 로 닫고 삽입한다 — 큐 안에 자리당 살아있는 값이 하나만 남는다.
   */
  supersedeKey: z.string().min(1).optional(),
});

const GetChainRequestSchema = z.object({
  rootId: z.string(),
});

const RetryRequestSchema = z.object({
  id: z.string(),
  cascade: CascadePolicySchema.optional(),
});

const ResolveRequestSchema = z.object({
  id: z.string(),
  reason: z.string().min(1),
  cascade: CascadePolicySchema.optional(),
});

const CancelRequestSchema = z.object({
  id: z.string(),
  reason: z.string().min(1),
});

const SupersedeRequestSchema = z.object({
  supersedeKey: z.string().min(1),
  /** 무엇이 대체했는가 — 행의 resolutionReason 에 남는다. */
  reason: z.string().min(1),
});

const SetCredentialsRequestSchema = z.object({
  /** GraphQL 엔드포인트 전체 URL. */
  endpoint: z.url(),
  token: z.string().min(1),
});

// ── Response result schemas ──────────────────────────────────────────────────

const EnqueueResultSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  /** 동일 idempotencyKey가 이미 있어서 새로 만들지 않고 기존 행을 재사용한 경우 true. */
  deduplicated: z.boolean(),
});

const DrainResultSchema = z.object({
  /** 이번 drain 호출로 PENDING 픽업이 트리거된 행 개수. */
  awakened: z.number().int().nonnegative(),
});

const GetChainResultSchema = z.array(OutboxMutationSchema);

const SupersedeResultSchema = z.object({
  /** 이번 호출로 SUPERSEDED 가 된 행 개수. 0 = 큐에 옛 값이 없었다(정상). */
  superseded: z.number().int().nonnegative(),
});

// ── Convenience type aliases (서비스 시그니처용) ──────────────────────────

export type EnqueueRequest = z.infer<typeof EnqueueRequestSchema>;
export type EnqueueResult = z.infer<typeof EnqueueResultSchema>;
export type DrainResult = z.infer<typeof DrainResultSchema>;
export type GetChainRequest = z.infer<typeof GetChainRequestSchema>;
export type GetChainResult = z.infer<typeof GetChainResultSchema>;
export type RetryRequest = z.infer<typeof RetryRequestSchema>;
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;
export type CancelRequest = z.infer<typeof CancelRequestSchema>;
export type SupersedeRequest = z.infer<typeof SupersedeRequestSchema>;
export type SupersedeResult = z.infer<typeof SupersedeResultSchema>;
export type SetCredentialsRequest = z.infer<typeof SetCredentialsRequestSchema>;

// ── Schemas dictionary ──────────────────────────────────────────────────────

export const OutboxSchemas = {
  [OUTBOX_EVENTS.ENQUEUE]: EnqueueRequestSchema,
  [OUTBOX_EVENTS.DRAIN]: z.void(),
  [OUTBOX_EVENTS.GET_CHAIN]: GetChainRequestSchema,
  [OUTBOX_EVENTS.RETRY]: RetryRequestSchema,
  [OUTBOX_EVENTS.RESOLVE]: ResolveRequestSchema,
  [OUTBOX_EVENTS.CANCEL]: CancelRequestSchema,
  [OUTBOX_EVENTS.SUPERSEDE]: SupersedeRequestSchema,
  [OUTBOX_EVENTS.SET_CREDENTIALS]: SetCredentialsRequestSchema,
} satisfies Record<keyof OutboxEventMap, z.ZodType>;

/**
 * 렌더러에게 여는 표면 — `SET_CREDENTIALS` 는 뺀다. 토큰의 유일한 출처는 백엔드 secure storage 이고,
 * 렌더러가 그 자격을 갈아끼울 수 있으면 출처가 둘이 된다.
 */
export const OutboxClientSchemas = {
  [OUTBOX_EVENTS.ENQUEUE]: EnqueueRequestSchema,
  [OUTBOX_EVENTS.DRAIN]: z.void(),
  [OUTBOX_EVENTS.GET_CHAIN]: GetChainRequestSchema,
  [OUTBOX_EVENTS.RETRY]: RetryRequestSchema,
  [OUTBOX_EVENTS.RESOLVE]: ResolveRequestSchema,
  [OUTBOX_EVENTS.CANCEL]: CancelRequestSchema,
  [OUTBOX_EVENTS.SUPERSEDE]: SupersedeRequestSchema,
} satisfies Record<keyof OutboxClientEventMap, z.ZodType>;

export const OutboxResponseSchemas = {
  [OUTBOX_EVENTS.ENQUEUE]: resultSchemaOf(
    EnqueueResultSchema,
    OutboxCauseSchema,
  ),
  [OUTBOX_EVENTS.DRAIN]: resultSchemaOf(DrainResultSchema, OutboxCauseSchema),
  [OUTBOX_EVENTS.GET_CHAIN]: resultSchemaOf(
    GetChainResultSchema,
    OutboxCauseSchema,
  ),
  [OUTBOX_EVENTS.RETRY]: resultVoidSchemaOf(OutboxCauseSchema),
  [OUTBOX_EVENTS.RESOLVE]: resultVoidSchemaOf(OutboxCauseSchema),
  [OUTBOX_EVENTS.CANCEL]: resultVoidSchemaOf(OutboxCauseSchema),
  [OUTBOX_EVENTS.SUPERSEDE]: resultSchemaOf(
    SupersedeResultSchema,
    OutboxCauseSchema,
  ),
  [OUTBOX_EVENTS.SET_CREDENTIALS]: resultVoidSchemaOf(OutboxCauseSchema),
} satisfies Record<keyof OutboxEventMap, z.ZodType>;

// ── EventMap ────────────────────────────────────────────────────────────────

export type OutboxEventMap = {
  [OUTBOX_EVENTS.ENQUEUE]: {
    request: z.infer<typeof EnqueueRequestSchema>;
    response: Result<z.infer<typeof EnqueueResultSchema>, OutboxCause>;
  };
  [OUTBOX_EVENTS.DRAIN]: {
    request: void;
    response: Result<z.infer<typeof DrainResultSchema>, OutboxCause>;
  };
  [OUTBOX_EVENTS.GET_CHAIN]: {
    request: z.infer<typeof GetChainRequestSchema>;
    response: Result<z.infer<typeof GetChainResultSchema>, OutboxCause>;
  };
  [OUTBOX_EVENTS.RETRY]: {
    request: z.infer<typeof RetryRequestSchema>;
    response: ResultVoid<OutboxCause>;
  };
  [OUTBOX_EVENTS.RESOLVE]: {
    request: z.infer<typeof ResolveRequestSchema>;
    response: ResultVoid<OutboxCause>;
  };
  [OUTBOX_EVENTS.CANCEL]: {
    request: z.infer<typeof CancelRequestSchema>;
    response: ResultVoid<OutboxCause>;
  };
  [OUTBOX_EVENTS.SUPERSEDE]: {
    request: z.infer<typeof SupersedeRequestSchema>;
    response: Result<z.infer<typeof SupersedeResultSchema>, OutboxCause>;
  };
  [OUTBOX_EVENTS.SET_CREDENTIALS]: {
    request: z.infer<typeof SetCredentialsRequestSchema>;
    response: ResultVoid<OutboxCause>;
  };
};

/** 렌더러 ↔ 백엔드 표면. 자격 주입은 백엔드만의 일이라 빠져 있다. */
export type OutboxClientEventMap = Omit<
  OutboxEventMap,
  typeof OUTBOX_EVENTS.SET_CREDENTIALS
>;

export const OutboxClientResponseSchemas = {
  [OUTBOX_EVENTS.ENQUEUE]: OutboxResponseSchemas[OUTBOX_EVENTS.ENQUEUE],
  [OUTBOX_EVENTS.DRAIN]: OutboxResponseSchemas[OUTBOX_EVENTS.DRAIN],
  [OUTBOX_EVENTS.GET_CHAIN]: OutboxResponseSchemas[OUTBOX_EVENTS.GET_CHAIN],
  [OUTBOX_EVENTS.RETRY]: OutboxResponseSchemas[OUTBOX_EVENTS.RETRY],
  [OUTBOX_EVENTS.RESOLVE]: OutboxResponseSchemas[OUTBOX_EVENTS.RESOLVE],
  [OUTBOX_EVENTS.CANCEL]: OutboxResponseSchemas[OUTBOX_EVENTS.CANCEL],
  [OUTBOX_EVENTS.SUPERSEDE]: OutboxResponseSchemas[OUTBOX_EVENTS.SUPERSEDE],
} satisfies Record<keyof OutboxClientEventMap, z.ZodType>;
