import { describe, expect, test } from 'bun:test';
import { ON_DEP_FAIL, OUTBOX_STATUS } from 'kiosk-types';
import type { OutboxMutationRow } from '../../db';
import {
  type FetchLike,
  GraphQLExecutor,
  type RemoteCredentials,
} from '../GraphQLExecutor';

// ── setup ──────────────────────────────────────────────────────────────

const CREDS: RemoteCredentials = {
  endpoint: 'https://api.example.com/graphql',
  token: 'tok-abc',
};

const row = (over: Partial<OutboxMutationRow> = {}): OutboxMutationRow => ({
  id: 'row-1',
  type: 'someType',
  payload: { query: 'mutation X { x }', variables: { a: 1 } },
  status: OUTBOX_STATUS.IN_FLIGHT,
  attempts: 0,
  lastError: null,
  nextAttemptAt: 0,
  pendingDepsCount: 0,
  onDepFail: ON_DEP_FAIL.CANCEL,
  rootId: 'row-1',
  resolutionReason: null,
  initialBackoffMs: 1_000,
  maxBackoffMs: 10_000,
  expiresAt: null,
  supersedeKey: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

type Call = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

function recordingFetch(
  reply: () => Promise<{ status: number; ok: boolean; body?: unknown }>,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const r = await reply();
    return {
      status: r.status,
      ok: r.ok,
      json: async () => r.body ?? {},
    };
  };
  return { fetch, calls };
}

const ok = () => Promise.resolve({ status: 200, ok: true, body: { data: {} } });

// ── 테스트 본체 ────────────────────────────────────────────────────────

describe('GraphQLExecutor', () => {
  // ── 1. 자격 ─────────────────────────────────────────────────────────

  describe('자격이 없으면 묻지 않는다', () => {
    test('credentials 미수신 → deferred, 요청 자체를 안 보낸다', async () => {
      const { fetch, calls } = recordingFetch(ok);
      const executor = new GraphQLExecutor({
        credentials: () => undefined,
        fetch,
      });

      const verdict = await executor.execute(row());

      expect(verdict.kind).toBe('deferred');
      expect(calls).toHaveLength(0); // 시도조차 하지 않았다
    });
  });

  // ── 2. 요청 모양 ────────────────────────────────────────────────────

  describe('요청 모양', () => {
    test('엔드포인트·토큰을 싣는다', async () => {
      const { fetch, calls } = recordingFetch(ok);
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        fetch,
      });

      await executor.execute(row());

      expect(calls[0]?.url).toBe(CREDS.endpoint);
      expect(calls[0]?.headers.Authorization).toBe('Bearer tok-abc');
    });

    /**
     * 게이트웨이가 2xx 를 24시간 재생하므로 키를 고정하면 서버가 답한 실패가 그대로
     * 잠긴다 — 회차를 섞어야 재시도가 실제로 실행된다.
     */
    test('멱등키는 `행 id : 시도 회차`', async () => {
      const { fetch, calls } = recordingFetch(ok);
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        fetch,
      });

      await executor.execute(row({ id: 'inclusion:res-9', attempts: 0 }));
      await executor.execute(row({ id: 'inclusion:res-9', attempts: 3 }));

      expect(calls[0]?.headers['Idempotency-Key']).toBe('inclusion:res-9:0');
      expect(calls[1]?.headers['Idempotency-Key']).toBe('inclusion:res-9:3');
    });

    test('같은 회차면 같은 키 — deferred 재시도가 원래 응답을 재생받는다', async () => {
      const { fetch, calls } = recordingFetch(ok);
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        fetch,
      });

      await executor.execute(row({ attempts: 2 }));
      await executor.execute(row({ attempts: 2 }));

      expect(calls[0]?.headers['Idempotency-Key']).toBe(
        calls[1]?.headers['Idempotency-Key'],
      );
    });

    test('payload 의 query/variables 를 그대로 보낸다 — 스키마를 해석하지 않는다', async () => {
      const { fetch, calls } = recordingFetch(ok);
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        fetch,
      });

      await executor.execute(
        row({
          payload: {
            query: 'mutation Charge($id: ID!) { charge(id: $id) { id } }',
            variables: { id: 'res-9' },
          },
        }),
      );

      expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
        query: 'mutation Charge($id: ID!) { charge(id: $id) { id } }',
        variables: { id: 'res-9' },
      });
    });

    test('variables 없는 payload 도 보낸다 (빈 객체로)', async () => {
      const { fetch, calls } = recordingFetch(ok);
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        fetch,
      });

      await executor.execute(row({ payload: { query: 'mutation { ping }' } }));

      expect(JSON.parse(calls[0]?.body ?? '{}').variables).toEqual({});
    });
  });

  // ── 3. payload 계약 위반 ────────────────────────────────────────────

  test('payload 에 query 가 없으면 permanent — 다시 보내도 같다', async () => {
    const { fetch, calls } = recordingFetch(ok);
    const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

    const verdict = await executor.execute(
      row({
        payload: { nope: true } as unknown as OutboxMutationRow['payload'],
      }),
    );

    expect(verdict.kind).toBe('permanent_failure');
    expect(calls).toHaveLength(0);
  });

  // ── 4. 응답 → verdict ───────────────────────────────────────────────

  describe('응답 판정 (classify 위임)', () => {
    test('200 + errors 없음 → success', async () => {
      const { fetch } = recordingFetch(ok);
      const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

      expect((await executor.execute(row())).kind).toBe('success');
    });

    test('200 + errors → 코드에 따라 판정', async () => {
      const { fetch } = recordingFetch(() =>
        Promise.resolve({
          status: 200,
          ok: true,
          body: { errors: [{ message: '이미 체크아웃됨' }] },
        }),
      );
      const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

      const verdict = await executor.execute(row());

      expect(verdict.kind).toBe('permanent_failure');
      if (verdict.kind !== 'permanent_failure') return;
      expect(verdict.error).toContain('이미 체크아웃됨');
    });

    test('409 → deferred (선행 요청이 처리 중이다)', async () => {
      const { fetch } = recordingFetch(() =>
        Promise.resolve({ status: 409, ok: false }),
      );
      const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

      expect((await executor.execute(row())).kind).toBe('deferred');
    });

    test('503 → transient', async () => {
      const { fetch } = recordingFetch(() =>
        Promise.resolve({ status: 503, ok: false }),
      );
      const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

      expect((await executor.execute(row())).kind).toBe('transient_failure');
    });

    test('401 → deferred (토큰 문제지 이 행의 잘못이 아니다)', async () => {
      const { fetch } = recordingFetch(() =>
        Promise.resolve({ status: 401, ok: false }),
      );
      const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

      expect((await executor.execute(row())).kind).toBe('deferred');
    });
  });

  // ── 5. 도달 실패 / 타임아웃 ─────────────────────────────────────────

  describe('봉투가 오지 않은 경우', () => {
    test('fetch 가 throw → deferred (도달 실패)', async () => {
      const fetch: FetchLike = () =>
        Promise.reject(new Error('getaddrinfo ENOTFOUND api.example.com'));
      const executor = new GraphQLExecutor({ credentials: () => CREDS, fetch });

      const verdict = await executor.execute(row());

      expect(verdict.kind).toBe('deferred');
      if (verdict.kind !== 'deferred') return;
      expect(verdict.reason).toContain('ENOTFOUND');
    });

    /**
     * 타임아웃이 없으면 Promise.all 이 안 풀리고 스케줄러의 finally 가 안 돌아
     * 다음 tick 이 영영 예약되지 않는다 — 큐 전체 정지다.
     */
    test('상한을 넘기면 abort 하고 deferred — 스케줄러를 붙들지 않는다', async () => {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        timeoutMs: 20,
        fetch,
      });

      const verdict = await executor.execute(row());

      expect(verdict.kind).toBe('deferred');
      if (verdict.kind !== 'deferred') return;
      expect(verdict.reason).toContain('20ms');
    });

    test('상한 안에 오면 정상 판정 — 타이머가 결과를 가로채지 않는다', async () => {
      const fetch: FetchLike = async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { status: 200, ok: true, json: async () => ({ data: {} }) };
      };
      const executor = new GraphQLExecutor({
        credentials: () => CREDS,
        timeoutMs: 500,
        fetch,
      });

      expect((await executor.execute(row())).kind).toBe('success');
    });
  });
});
