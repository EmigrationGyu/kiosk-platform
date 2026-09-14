/**
 * executor 가 원격에 대고 **관측한 사실**. 원시 fetch 결과가 아니라 정규화된 형태다.
 *
 * 이 경계가 있어야 판정(classify)이 순수 함수로 남는다 — 하드웨어·네트워크의 불확실성은
 * 어댑터가 여기까지 끌고 오고, 그 앞은 값으로만 논다.
 */
export type GraphQLErrorShape = {
  message: string;
  extensions?: { code?: string };
};

export type RemoteOutcome =
  /** 200 + errors 없음. */
  | { kind: 'ok' }
  /** 소켓조차 못 열었다 — DNS·ECONNREFUSED·오프라인. 봉투가 오지 않았다. */
  | { kind: 'unreachable'; detail: string }
  /** 보냈지만 시간 안에 답이 없었다. 서버가 처리했는지 알 수 없다. */
  | { kind: 'timeout'; afterMs: number }
  /** HTTP 응답이 왔다(비-2xx). 서버가 답을 한 것이다. */
  | { kind: 'http'; status: number }
  /** 200 이지만 GraphQL errors 가 실려 왔다. */
  | { kind: 'graphql'; errors: readonly GraphQLErrorShape[] };

/** 판정에 쓰는 HTTP 상태 — 닫힌 집합으로 두어 숫자 리터럴이 분기에 흩어지지 않게 한다. */
export const HTTP = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  REQUEST_TIMEOUT: 408,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR_FLOOR: 500,
} as const;

/**
 * **다시 물어볼 가치가 있는** GraphQL 에러 코드만 센다 — 나머지는 서버가 이 요청을 거절한 것이라 permanent 다.
 */
export const GQL_CODE = {
  /** 토큰 문제 — 이 행의 잘못이 아니다. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  /** 서버 내부 오류 — 다음에 되기도 한다. */
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;
