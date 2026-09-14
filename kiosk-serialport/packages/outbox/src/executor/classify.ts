import type { MutationExecutionResult } from '../scheduler/MutationExecutor';
import { GQL_CODE, HTTP, type RemoteOutcome } from './outcome';

const messagesOf = (errors: readonly { message: string }[]): string =>
  errors.map((e) => e.message).join(' | ');

const codesOf = (
  errors: readonly { extensions?: { code?: string } }[],
): string[] =>
  errors
    .map((e) => e.extensions?.code)
    .filter((c): c is string => typeof c === 'string');

/**
 * 관측 → verdict. **순수 함수다** — 시계도 난수도 네트워크도 보지 않는다.
 *
 * 축은 "봉투가 왔는가" 하나다(승격 판정이 쓰는 축과 같다):
 *
 * | 관측 | verdict | 왜 |
 * |------|---------|-----|
 * | 도달 실패·타임아웃·401/403 | `deferred` | 묻지 못했거나 내 자격 문제 — 이 행의 시도가 아니다 |
 * | 5xx·429·408 | `transient` | 서버가 답했고 다음엔 될 수 있다 |
 * | 4xx·비즈니스 거절 | `permanent` | 서버가 이 요청을 거절했다. 다시 보내도 같다 |
 *
 * 타임아웃이 deferred 인 이유: 서버가 처리했는지 **알 수 없다**. 실패로 세면 처리된 요청을 실패로
 * 기록하고, 성공으로 세면 안 된 것을 됐다고 한다 — 모르는 것은 모르는 대로 두고 다시 묻는다.
 */
export function classify(outcome: RemoteOutcome): MutationExecutionResult {
  switch (outcome.kind) {
    case 'ok':
      return { kind: 'success' };

    case 'unreachable':
      return { kind: 'deferred', reason: `도달 실패: ${outcome.detail}` };

    case 'timeout':
      return {
        kind: 'deferred',
        reason: `${outcome.afterMs}ms 안에 답이 없었다 — 처리 여부 불명`,
      };

    case 'http':
      return classifyStatus(outcome.status);

    case 'graphql':
      return classifyGraphQL(outcome.errors);

    default: {
      // outcome 이 늘면 여기서 컴파일 에러가 난다.
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

function classifyStatus(status: number): MutationExecutionResult {
  if (status === HTTP.UNAUTHORIZED || status === HTTP.FORBIDDEN) {
    // 토큰이 만료·회수된 것이지 이 행이 틀린 게 아니다. 시도를 소모하면 렌더러가
    // 토큰을 새로 물어오기 전에 큐가 말라버린다.
    return { kind: 'deferred', reason: `자격 거절 (HTTP ${status})` };
  }

  if (status === HTTP.CONFLICT) {
    // `IDEMPOTENT_REQUEST_PROCESSING` — **이미 처리됐다가 아니라 처리 중이다.** 게이트웨이가 같은 키의
    // 선행 요청을 위해 잡아둔 락(5분)에 걸린 것이라 결과를 아직 모른다. 같은 키로 나중에 다시 물으면
    // 완료된 응답이 재생된다 — deferred 가 정확히 그 동작이다(attempts 보존 = 다음 시도도 같은 키).
    return { kind: 'deferred', reason: '선행 요청 처리 중 (HTTP 409)' };
  }

  if (
    status === HTTP.REQUEST_TIMEOUT ||
    status === HTTP.TOO_MANY_REQUESTS ||
    status >= HTTP.SERVER_ERROR_FLOOR
  ) {
    return { kind: 'transient_failure', error: `HTTP ${status}` };
  }

  if (status === HTTP.BAD_REQUEST) {
    // 400 은 `INVALID_IDEMPOTENCY_KEY`(요청 해시 불일치)일 수 있다 — 같은 키로 다른
    // 내용을 보냈다는 뜻이고, 행의 payload 는 enqueue 후 불변이므로 우리 버그다.
    // 다시 보내도 같으니 사람이 봐야 한다.
    return { kind: 'permanent_failure', error: `HTTP 400 (요청 거절)` };
  }

  return { kind: 'permanent_failure', error: `HTTP ${status}` };
}

function classifyGraphQL(
  errors: readonly { message: string; extensions?: { code?: string } }[],
): MutationExecutionResult {
  // 어댑터가 errors 있음으로 분류해 놓고 비워 보냈다면 계약 위반이다. 성공으로
  // 흘리면 안 일어난 일을 됐다고 기록한다.
  if (errors.length === 0) {
    return {
      kind: 'permanent_failure',
      error: 'GraphQL errors 가 비어 있다 (어댑터 계약 위반)',
    };
  }

  const codes = codesOf(errors);
  const messages = messagesOf(errors);

  if (
    codes.includes(GQL_CODE.UNAUTHENTICATED) ||
    codes.includes(GQL_CODE.FORBIDDEN)
  ) {
    return { kind: 'deferred', reason: `자격 거절: ${messages}` };
  }

  if (codes.includes(GQL_CODE.INTERNAL_SERVER_ERROR)) {
    return { kind: 'transient_failure', error: messages };
  }

  return { kind: 'permanent_failure', error: messages };
}
