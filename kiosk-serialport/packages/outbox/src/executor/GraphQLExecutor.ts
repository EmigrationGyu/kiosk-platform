import { outboxIdempotencyKey } from 'kiosk-types';
import type { OutboxMutationRow } from '../db';
import type {
  MutationExecutionResult,
  MutationExecutor,
} from '../scheduler/MutationExecutor';
import { classify } from './classify';
import type { GraphQLErrorShape, RemoteOutcome } from './outcome';

/**
 * 이 프로세스가 원격에 말을 걸 수 있는 자격. 백엔드가 부팅 때·토큰이 갈릴 때 넘긴다.
 * 디스크에 쓰지 않는다 — 재기동하면 비어 있고, 그동안은 그냥 묻지 않는다.
 */
export type RemoteCredentials = {
  /** GraphQL 엔드포인트 전체 URL. */
  endpoint: string;
  token: string;
};

/** 경계를 넘어온 payload — outbox 는 GraphQL 스키마를 모른 채 그대로 실어 보낸다. */
export type OperationPayload = {
  query: string;
  variables?: Record<string, unknown>;
};

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export type GraphQLExecutorDeps = {
  /** 자격이 아직 없으면 undefined — 실패가 아니라 "아직 못 묻는다". */
  credentials: () => RemoteCredentials | undefined;
  /** 한 건당 상한. 없으면 Promise.all 이 안 풀려 스케줄러 전체가 멈춘다. */
  timeoutMs?: number;
  fetch?: FetchLike;
};

/** 30초. 프론트 Apollo 의 VITE_GRAPHQL_TIMEOUT_MS 기본값과 같은 값으로 맞춘다. */
const DEFAULT_TIMEOUT_MS = 30_000;

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

const isOperationPayload = (v: unknown): v is OperationPayload =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { query?: unknown }).query === 'string';

/**
 * 원격 GraphQL 로 mutation 한 건을 발사한다.
 *
 * **outbox 는 GraphQL 스키마를 모른다.** 행의 payload 가 `{ query, variables }` 를 그대로 들고 있고
 * 여기서는 HTTP 로 옮기기만 한다 — 스키마가 바뀌어도 이 프로세스는 재배포 대상이 아니다.
 *
 * **멱등 키는 `행 id : 시도 회차` 다.** 게이트웨이는 2xx 를 24시간 캐시했다가 재생하는데 GraphQL 은
 * 서버 장애도 200 으로 주므로, 키를 고정하면 일시적 실패가 하루 잠긴다. 회차를 섞으면
 * `deferred`/`transient` 구분이 그대로 키 정책이 된다.
 */
export class GraphQLExecutor implements MutationExecutor {
  private credentials: () => RemoteCredentials | undefined;
  private timeoutMs: number;
  private fetchImpl: FetchLike;

  constructor(deps: GraphQLExecutorDeps) {
    this.credentials = deps.credentials;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  async execute(row: OutboxMutationRow): Promise<MutationExecutionResult> {
    const creds = this.credentials();
    if (!creds) {
      // 자격의 부재는 이 행의 실패가 아니다. 백엔드가 아직 안 넘겼거나 방금 재기동했다.
      return { kind: 'deferred', reason: '자격 미수신 — 아직 물어볼 수 없다' };
    }

    if (!isOperationPayload(row.payload)) {
      // 호출부가 계약을 어겼다. 다시 보내도 같으므로 사람이 봐야 한다.
      return {
        kind: 'permanent_failure',
        error: `payload 에 query 가 없다 (type=${row.type})`,
      };
    }

    return classify(await this.send(row, row.payload, creds));
  }

  private async send(
    row: OutboxMutationRow,
    payload: OperationPayload,
    creds: RemoteCredentials,
  ): Promise<RemoteOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(creds.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
          // 회차를 섞은 키 — 게이트웨이가 2xx 를 24시간 재생하므로 고정 키를 쓰면
          // 서버가 답한 실패가 그대로 잠긴다(outboxIdempotencyKey 주석 참고).
          [IDEMPOTENCY_HEADER]: outboxIdempotencyKey(row.id, row.attempts),
        },
        body: JSON.stringify({
          query: payload.query,
          variables: payload.variables ?? {},
        }),
        signal: controller.signal,
      });

      if (!response.ok) return { kind: 'http', status: response.status };

      const body = await response.json();
      const errors = graphQLErrorsOf(body);
      return errors ? { kind: 'graphql', errors } : { kind: 'ok' };
    } catch (e) {
      // abort 인지 도달 실패인지 갈린다 — 둘 다 deferred 지만 사유가 다르다.
      if (controller.signal.aborted) {
        return { kind: 'timeout', afterMs: this.timeoutMs };
      }
      return {
        kind: 'unreachable',
        detail: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 응답 body 에서 GraphQL errors 를 꺼낸다. 없으면 undefined(= 성공). */
function graphQLErrorsOf(body: unknown): GraphQLErrorShape[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;

  return errors.map((e) => ({
    message:
      typeof (e as { message?: unknown })?.message === 'string'
        ? (e as { message: string }).message
        : String(e),
    extensions: (e as { extensions?: { code?: string } })?.extensions,
  }));
}
