import { describe, expect, test } from 'bun:test';
import { classify } from '../classify';
import { GQL_CODE, HTTP, type RemoteOutcome } from '../outcome';

/**
 * 판정의 축은 하나다 — **봉투가 왔는가.** 승격 판정이 쓰는 축과 같다.
 *
 *   묻지 못했다        → deferred  (시도로 세지 않는다)
 *   서버가 답했고 실패  → transient (attempts++ 후 백오프)
 *   서버가 거절했다     → permanent (즉시 DEAD)
 *
 * 이 구분을 접으면 오프라인이 큐를 통째로 종결시킨다.
 */
describe('classify', () => {
  // ── 1. 성공 ─────────────────────────────────────────────────────────

  test('ok → success', () => {
    expect(classify({ kind: 'ok' })).toEqual({ kind: 'success' });
  });

  // ── 2. 묻지 못한 것 — deferred ──────────────────────────────────────

  describe('묻지 못했다 → deferred (시도를 소모하지 않는다)', () => {
    test('unreachable (오프라인·DNS·ECONNREFUSED)', () => {
      const verdict = classify({
        kind: 'unreachable',
        detail: 'ECONNREFUSED',
      });

      expect(verdict.kind).toBe('deferred');
    });

    test('timeout — 처리됐는지 알 수 없으니 시도로 세지 않는다', () => {
      const verdict = classify({ kind: 'timeout', afterMs: 30_000 });

      expect(verdict.kind).toBe('deferred');
    });

    test.each([
      HTTP.UNAUTHORIZED,
      HTTP.FORBIDDEN,
    ])('HTTP %i — 토큰 문제지 이 행의 잘못이 아니다', (status) => {
      expect(classify({ kind: 'http', status }).kind).toBe('deferred');
    });

    test('GraphQL UNAUTHENTICATED', () => {
      const verdict = classify({
        kind: 'graphql',
        errors: [
          {
            message: 'jwt expired',
            extensions: { code: GQL_CODE.UNAUTHENTICATED },
          },
        ],
      });

      expect(verdict.kind).toBe('deferred');
    });

    test('deferred 는 사유를 싣는다 — 로그가 원인을 알아야 한다', () => {
      const verdict = classify({
        kind: 'unreachable',
        detail: 'getaddrinfo ENOTFOUND api.example.com',
      });

      expect(verdict.kind).toBe('deferred');
      if (verdict.kind !== 'deferred') return;
      expect(verdict.reason).toContain('ENOTFOUND');
    });
  });

  // ── 3. 서버가 답했으나 실패 — transient ─────────────────────────────

  describe('서버가 답했고 다시 해볼 만하다 → transient', () => {
    test.each([500, 502, 503, 504])('HTTP %i (5xx)', (status) => {
      expect(classify({ kind: 'http', status }).kind).toBe('transient_failure');
    });

    test('HTTP 429 — 속도 제한은 기다리면 풀린다', () => {
      expect(
        classify({ kind: 'http', status: HTTP.TOO_MANY_REQUESTS }).kind,
      ).toBe('transient_failure');
    });

    test('HTTP 408 — 서버가 스스로 타임아웃을 알려왔다', () => {
      expect(
        classify({ kind: 'http', status: HTTP.REQUEST_TIMEOUT }).kind,
      ).toBe('transient_failure');
    });

    test('GraphQL INTERNAL_SERVER_ERROR', () => {
      const verdict = classify({
        kind: 'graphql',
        errors: [
          {
            message: 'boom',
            extensions: { code: GQL_CODE.INTERNAL_SERVER_ERROR },
          },
        ],
      });

      expect(verdict.kind).toBe('transient_failure');
    });

    test('transient 는 에러 문구를 싣는다 — lastError 로 남는다', () => {
      const verdict = classify({ kind: 'http', status: 503 });

      expect(verdict.kind).toBe('transient_failure');
      if (verdict.kind !== 'transient_failure') return;
      expect(verdict.error).toContain('503');
    });
  });

  // ── 4. 서버가 거절 — permanent ──────────────────────────────────────

  describe('서버가 거절했다 → permanent (재시도 무의미)', () => {
    test.each([400, 404, 422])('HTTP %i (4xx 검증/경로 오류)', (status) => {
      expect(classify({ kind: 'http', status }).kind).toBe('permanent_failure');
    });

    test('GraphQL 비즈니스 거절 (코드 없음)', () => {
      const verdict = classify({
        kind: 'graphql',
        errors: [{ message: '이미 체크아웃된 예약입니다' }],
      });

      expect(verdict.kind).toBe('permanent_failure');
      if (verdict.kind !== 'permanent_failure') return;
      expect(verdict.error).toContain('이미 체크아웃된 예약입니다');
    });

    test('GraphQL BAD_USER_INPUT 같은 미등록 코드도 거절로 본다', () => {
      const verdict = classify({
        kind: 'graphql',
        errors: [
          { message: 'bad input', extensions: { code: 'BAD_USER_INPUT' } },
        ],
      });

      expect(verdict.kind).toBe('permanent_failure');
    });

    test('errors 여러 건 — 문구를 모두 남긴다', () => {
      const verdict = classify({
        kind: 'graphql',
        errors: [{ message: 'first' }, { message: 'second' }],
      });

      if (verdict.kind !== 'permanent_failure') return;
      expect(verdict.error).toContain('first');
      expect(verdict.error).toContain('second');
    });

    test('errors 배열이 비어 있으면 성공으로 보지 않는다 — 어댑터 계약 위반', () => {
      const verdict = classify({ kind: 'graphql', errors: [] });

      expect(verdict.kind).toBe('permanent_failure');
    });
  });

  // ── 5. 409 — 처리 중 ────────────────────────────────────────────────

  /**
   * 게이트웨이의 409 는 `IDEMPOTENT_REQUEST_PROCESSING` — **이미 처리됐다가 아니라**
   * 선행 요청이 락(5분)을 쥐고 있다는 뜻이다(서버 소스 실측).
   *
   * 결과를 모르므로 성공으로도 실패로도 닫지 않는다. attempts 를 보존하면 다음 시도가
   * 같은 키로 나가고, 그때 완료된 응답이 재생된다.
   */
  test('HTTP 409 — 처리 중이므로 deferred (성공으로 닫지 않는다)', () => {
    const verdict = classify({ kind: 'http', status: HTTP.CONFLICT });

    expect(verdict.kind).toBe('deferred');
  });

  test('400 — 요청 해시 불일치(우리 버그)는 재시도로 안 풀린다', () => {
    expect(classify({ kind: 'http', status: HTTP.BAD_REQUEST }).kind).toBe(
      'permanent_failure',
    );
  });

  // ── 6. 순수성 ───────────────────────────────────────────────────────

  test('같은 입력은 항상 같은 판정 — 시계도 난수도 보지 않는다', () => {
    const outcome: RemoteOutcome = { kind: 'http', status: 503 };

    expect(classify(outcome)).toEqual(classify(outcome));
  });
});
