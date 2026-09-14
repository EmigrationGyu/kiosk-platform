/**
 * 큐에 들어갈 수 있는 작업의 닫힌 집합 — 행의 `type` 컬럼이 드는 값.
 *
 * 여기 없는 작업은 outbox 를 타지 않는다. **등록 자체가 판단**이라 자동 수집하지 않는다:
 * "늦게라도 반영되는 게 나은가"는 도메인이 답하는 질문이고, 어떤 작업은 늦은 성공이 안 하느니만
 * 못하다(TTL 이 이미 푼 방의 release, 정산 끝난 손님의 청구).
 */
export const OUTBOX_MUTATION = {
  /**
   * 레이트체크아웃 요금 청구. 나가면 못 받는 돈이다. 같은 뮤테이션의 **조기입실 경로는 여기
   * 오지 않는다** — 청구 직후 예약을 다시 읽어 잔액으로 결제액을 정하므로, 큐로 넘기면 미청구
   * 상태로 결제된다.
   */
  CHARGE_CHECK_TIME_FEE: 'charge-check-time-fee',
  /**
   * 결제 취소 기록. 서버는 카드사를 부르지 않는다 — 물리적 취소는 단말이 이미 끝냈고 이건
   * 장부다. 그래서 **늦은 성공이 오히려 옳다**: 돈은 나갔는데 기록이 없는 게 최악이다.
   */
  CANCEL_PAYMENT: 'cancel-payment',
  /**
   * 카드키 발급/회수 누적 매수. 절대값 set 이라 자연 멱등이지만, **순서가 뒤집히면 옛
   * 값이 최신을 되돌린다** — 그래서 supersedeKey 로 자리를 선언해 더 새 값이 확정되는
   * 순간 옛 행을 닫는다.
   */
  SET_KEY_COUNTS: 'set-key-counts',
  /** 약관 동의 기록. */
  AGREE_TERMS: 'agree-terms',
  /**
   * 결제 미완 이탈 예약 수거 — 가예약 전환 후 취소. 둘은 한 세트다. 늦게 나가도 안전하다:
   * 서버가 revert 는 `roomId` 없고 DEFINITE/TENTATIVE 일 때만, delete 는 INQUIRY/TENTATIVE
   * 일 때만 받으므로 손님이 돌아와 체크인을 마쳤으면 둘 다 거절된다.
   */
  REVERT_RESERVATION: 'revert-reservation',
  DELETE_RESERVATION: 'delete-reservation',
} as const;

/**
 * **outbox 를 태우지 않기로 한 것 중, 그 판단에 근거가 있는 것.**
 *
 * `cancelAssignReservation` — API 가 `reservationId` 만 받아 서버는 "지금 배정된 방이 무엇이든"
 * 푼다. 지연된 취소가 나중에 직원이 새로 넣은 배정을 풀 수 있고 막을 수단이 API 에 없다.
 *
 * `addBillToFolio` — **응답을 다음 단계가 읽는다**(미수금 정산은 `payment.id` 를, 분실료 청구는
 * 직후 재조회한 예약을 쓴다). 큐는 **아무도 되읽지 않는 호출**만 대신할 수 있다.
 */

export type OutboxMutationType =
  (typeof OUTBOX_MUTATION)[keyof typeof OUTBOX_MUTATION];

/**
 * 서버에 실어 보낼 `Idempotency-Key`.
 *
 * **시도 회차를 섞는 이유** — 게이트웨이는 2xx 응답을 24시간 캐시하는데 GraphQL 은 서버 장애도
 * HTTP 200 으로 주므로, 키를 고정하면 일시적 실패가 24시간 잠긴다(실측: Prisma 오류가 계속 재생됨).
 * 회차를 섞으면 verdict 의 구분이 그대로 키 정책이 된다:
 *
 * | verdict | attempts | 키 | 뜻 |
 * |---------|----------|-----|-----|
 * | `deferred` (답을 못 받음) | 보존 | **같은 키** | 성공했었다면 재생받는다 — 중복 실행 방지 |
 * | `transient` (서버가 답함) | ++ | **새 키** | 캐시된 실패를 물려받지 않는다 |
 *
 * 직접 호출과 큐가 **같은 규칙**을 써야 한다 — 프론트의 첫 호출이 회차 0 이고 큐의 첫 시도도
 * 회차 0 이라야 응답만 유실된 요청이 두 번 실행되지 않는다(부팅 복구도 attempts 를 보존한다).
 * 게이트웨이 상한 300자, `type:id` 가 그보다 길어질 일은 없다.
 */
export const outboxIdempotencyKey = (rowId: string, attempts: number): string =>
  `${rowId}:${attempts}`;

/** Outbox 시스템 에러 코드 */
export const OUTBOX_ERROR_CODE = {
  // enqueue 단계
  /** 같은 id 가 다른 type 으로 이미 존재 — 호출부 키 derivation 충돌 */
  ID_TYPE_MISMATCH: 0x01,
  UNKNOWN_MUTATION_TYPE: 0x02,
  INVALID_PAYLOAD: 0x03,
  DEPENDENCY_NOT_FOUND: 0x04,

  // 운영 액션 단계 (retry/resolve/cancel/getChain)
  NOT_FOUND: 0x10,
  INVALID_STATE_TRANSITION: 0x11,

  // 시스템
  INTERNAL_ERROR: 0xff,
} as const;

export type OutboxErrorCode =
  (typeof OUTBOX_ERROR_CODE)[keyof typeof OUTBOX_ERROR_CODE];

export type OutboxCause = keyof typeof OUTBOX_ERROR_CODE;

export const OUTBOX_ERROR_MESSAGE: Record<OutboxErrorCode, OutboxCause> = {
  [OUTBOX_ERROR_CODE.ID_TYPE_MISMATCH]: 'ID_TYPE_MISMATCH',
  [OUTBOX_ERROR_CODE.UNKNOWN_MUTATION_TYPE]: 'UNKNOWN_MUTATION_TYPE',
  [OUTBOX_ERROR_CODE.INVALID_PAYLOAD]: 'INVALID_PAYLOAD',
  [OUTBOX_ERROR_CODE.DEPENDENCY_NOT_FOUND]: 'DEPENDENCY_NOT_FOUND',
  [OUTBOX_ERROR_CODE.NOT_FOUND]: 'NOT_FOUND',
  [OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION]: 'INVALID_STATE_TRANSITION',
  [OUTBOX_ERROR_CODE.INTERNAL_ERROR]: 'INTERNAL_ERROR',
};

/**
 * Mutation 실행 상태. 재시도 대기는 별도 상태가 아니라 `status=PENDING` + `attempts > 0`
 * + `nextAttemptAt > now()` 조합으로 표현된다.
 */
export const OUTBOX_STATUS = {
  /** 의존성 만족 + nextAttemptAt 도래 시 픽업 대기 (재시도 백오프 중인 행도 동일) */
  PENDING: 'PENDING',
  /** 워커가 원격 호출 진행 중 (부팅 시 PENDING으로 리셋) */
  IN_FLIGHT: 'IN_FLIGHT',
  /** 원격 서버 성공 응답 수신 */
  SUCCESS: 'SUCCESS',
  /** permanent_failure 응답 — 서버가 거절했다. 자동 재시도 중단, 운영자는 retry 가능 */
  DEAD: 'DEAD',
  /** 부모 영구 실패 cascade 또는 운영자 cancel */
  CANCELLED: 'CANCELLED',
  /** 외부 경로로 비즈니스 완료 처리됨 (resolve 액션) */
  RESOLVED_EXTERNAL: 'RESOLVED_EXTERNAL',
  /**
   * 유효기간(expiresAt)이 지났다. DEAD 와 가르는 이유는 하나 — **retry 를 거부하기 위해서다.**
   * 어떤 작업은 늦은 성공이 안 하느니만 못한데(정산 끝난 손님에게 붙는 청구), 상태로 갈라두지
   * 않으면 콘솔도 그 구분을 못 해 직원이 무심코 되살린다.
   */
  EXPIRED: 'EXPIRED',
  /**
   * 같은 자리(supersedeKey)의 더 새 값이 이 행을 대체했다.
   *
   * 절대값 set(카드키 매수 등)은 순서가 뒤집히면 옛 값이 최신을 되돌린다 — 큐에 앉은 3장 기록이
   * 직접 호출로 성공한 4장 기록 뒤에 나가는 식이다. EXPIRED 와 같은 이유로 상태를 가른다:
   * **retry 를 거부하기 위해서**이고, 낡은 절대값을 되살리는 것이 정확히 그 버그다.
   */
  SUPERSEDED: 'SUPERSEDED',
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

/** 비즈니스가 이뤄진 종결. 자식 입장에선 의존성이 만족된 것. */
export const OUTBOX_TERMINAL_SUCCESS = [
  OUTBOX_STATUS.SUCCESS,
  OUTBOX_STATUS.RESOLVED_EXTERNAL,
] as const;

/** 비즈니스가 이뤄지지 않은 종결. 자식에게 onDepFail 이 적용되는 쪽. */
export const OUTBOX_TERMINAL_FAILURE = [
  OUTBOX_STATUS.DEAD,
  OUTBOX_STATUS.CANCELLED,
  OUTBOX_STATUS.EXPIRED,
  OUTBOX_STATUS.SUPERSEDED,
] as const;

const TERMINAL: readonly OutboxStatus[] = [
  ...OUTBOX_TERMINAL_SUCCESS,
  ...OUTBOX_TERMINAL_FAILURE,
];

/**
 * 더 이상 스스로 움직이지 않는 상태인가. 새 종결 상태가 늘면 위 두 집합에만 넣으면 되고,
 * cascade·enqueue 가 각자 열거하던 목록이 어긋날 자리가 사라진다.
 */
export const isTerminalStatus = (status: OutboxStatus): boolean =>
  TERMINAL.includes(status);

export const isTerminalSuccess = (status: OutboxStatus): boolean =>
  (OUTBOX_TERMINAL_SUCCESS as readonly OutboxStatus[]).includes(status);

export const isTerminalFailure = (status: OutboxStatus): boolean =>
  (OUTBOX_TERMINAL_FAILURE as readonly OutboxStatus[]).includes(status);

/** 부모 mutation이 영구 실패했을 때 자식 처리 정책 (enqueue 시점에 결정) */
export const ON_DEP_FAIL = {
  /** 후손도 CANCELLED로 cascade. 기본값. */
  CANCEL: 'CANCEL',
  /** 부모 실패 무시하고 자식은 그대로 실행. 로깅처럼 독립적인 후속에 사용. */
  PROCEED: 'PROCEED',
} as const;

export type OnDepFail = (typeof ON_DEP_FAIL)[keyof typeof ON_DEP_FAIL];

/** retry/resolve 액션 시 후손(CANCELLED) 처리 정책 */
export const CASCADE_POLICY = {
  /** CANCELLED 후손을 PENDING으로 되살림. resolve 기본값. */
  REACTIVATE: 'REACTIVATE',
  /** 후손 상태 그대로 유지. 후손도 외부 처리됐을 때. */
  LEAVE: 'LEAVE',
  /** 후손을 명시적으로 CANCELLED 유지/전파. 거의 사용하지 않음. */
  CANCEL: 'CANCEL',
} as const;

export type CascadePolicy =
  (typeof CASCADE_POLICY)[keyof typeof CASCADE_POLICY];

/**
 * 재시도 정책 기본값. 키오스크는 엣지 단말이라 장애가 초 단위로 회복되는 경우가 거의 없어
 * 분 단위 백오프를 쓴다(1m → 2m → 4m → 8m cap, jitter ±25%).
 *
 * **자동 종료는 횟수가 아니라 기한이 결정한다**(`expiresAt`). 몇 번 시도했는지는 기획도 운영도
 * 묻지 않는 수이고, 답할 수 있는 질문은 "언제까지 반영돼야 하는가" 뿐이다. 종료 조건을 둘 두면
 * 호출부가 둘 다 봐야 하므로 횟수 상한은 두지 않는다 — 재시도할 가치가 없는 실패는 `classify`
 * 가 permanent 로 표현한다.
 */
export const DEFAULT_RETRY_POLICY = {
  INITIAL_BACKOFF_MS: 60_000, // 1분
  MAX_BACKOFF_MS: 480_000, // 8분
  /** 백오프 jitter ±ratio — 0.25 → [0.75x, 1.25x]. thundering herd 방지. */
  JITTER_RATIO: 0.25,
  /**
   * 도달 자체가 안 된 뒤(offline·토큰 부재) 다시 물어보기까지의 간격. 지수 백오프를 쓰지
   * 않는다 — 이 대기는 서버 부담을 덜어주는 게 아니라 그냥 못 물어본 시간이다. jitter 는
   * 그대로 적용한다: ISP 장애가 걷히면 여러 키오스크가 같은 순간에 몰려온다.
   */
  DEFERRED_RETRY_MS: 30_000,
  /**
   * 호출부가 기한을 말하지 않았을 때의 기본 유효기간. 무기한은 명시적 선택이어야 한다 —
   * 잊힌 행이 영원히 서버를 두드리는 건 재시도가 아니라 장애다.
   */
  DEFAULT_EXPIRY_MS: 7 * 24 * 60 * 60_000, // 7일
} as const;
