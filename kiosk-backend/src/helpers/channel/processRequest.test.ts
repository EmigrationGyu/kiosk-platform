import { describe, expect, test } from 'bun:test';
import { isContractMismatch } from 'kiosk-types';
import { z } from 'zod';
import { processRequest } from './processRequest';

const EVENT = '/test_event';

const okHandler = (received: unknown[]) =>
  (async (body: any, res: any) => {
    received.push(body);
    return res.ok(200, { echoed: body });
  }) as any;

describe('processRequest — 채널 공통 파이프라인', () => {
  test('검증 실패는 throw 가 아니라 BAD_REQUEST 봉투로 반환된다 (id 보존)', async () => {
    const schema = z.object({ amount: z.number() });
    const response = await processRequest(
      EVENT,
      { id: 'req-1', body: { amount: 'not-a-number' } },
      schema,
      okHandler([]),
    );

    expect(response.ok).toBe(false);
    expect(response.code).toBe(400);
    expect(response.id).toBe('req-1');
    if (!response.ok) {
      expect(response.cause).toContain('Validation error');
    }
  });

  test('핸들러는 원본 body 가 아니라 parse 결과를 받는다 — 미선언 키 strip', async () => {
    const schema = z.object({ roomId: z.string() });
    const received: unknown[] = [];

    const response = await processRequest(
      EVENT,
      { id: 'req-4', body: { roomId: 'r-101', injected: 'extra-field' } },
      schema,
      okHandler(received),
    );

    expect(response.ok).toBe(true);
    // 스키마에 없는 키는 핸들러에 도달하면 안 된다
    expect(received[0]).toEqual({ roomId: 'r-101' });
  });

  test('스키마 default 가 핸들러 인자에 실제로 적용된다', async () => {
    const schema = z.object({
      count: z.number().default(1),
    });
    const received: unknown[] = [];

    await processRequest(
      EVENT,
      { id: 'req-5', body: {} },
      schema,
      okHandler(received),
    );

    expect(received[0]).toEqual({ count: 1 });
  });

  test('핸들러 성공은 {result, ok:true, code} 봉투가 된다', async () => {
    const response = await processRequest(
      EVENT,
      { id: 'req-6', body: { roomId: 'r-1' } },
      z.object({ roomId: z.string() }),
      (async (_body: any, res: any) => res.ok(201, { issued: true })) as any,
    );

    expect(response).toEqual({
      result: { issued: true },
      id: 'req-6',
      code: 201,
      ok: true,
    });
  });

  test('핸들러의 도메인 실패는 {cause, ok:false, code} 봉투가 된다', async () => {
    const response = await processRequest(
      EVENT,
      { id: 'req-7', body: {} },
      z.object({}),
      (async (_body: any, res: any) => res.error(409, 'CARD_JAMMED')) as any,
    );

    expect(response).toEqual({
      cause: 'CARD_JAMMED',
      id: 'req-7',
      code: 409,
      ok: false,
    });
  });

  test('핸들러 예외는 500 봉투로 격리된다', async () => {
    const response = await processRequest(
      EVENT,
      { id: 'req-8', body: {} },
      z.object({}),
      (async () => {
        throw new Error('boom');
      }) as any,
    );

    expect(response).toEqual({
      id: 'req-8',
      code: 500,
      ok: false,
      cause: 'Internal Server Error',
    });
  });
});

/**
 * 계약 불일치 박제.
 *
 * "상대가 이 이벤트를 모른다"와 "페이로드가 틀렸다"와 "상대가 터졌다"는 복구 방식이
 * 서로 다르다 — 각각 되감기·요청 수정·재시도다. 셋이 같은 500 으로 뭉개지면 원격 부분
 * 업데이트가 무엇을 해야 할지 알 수 없으므로, 구별되는 상태를 여기서 고정한다.
 */
describe('processRequest — 계약 불일치', () => {
  test('모르는 이벤트(스키마 부재)는 계약 불일치로 돌아온다', async () => {
    const response = await processRequest(
      '/unknown_event',
      { id: 'req-x', body: {} },
      undefined,
      okHandler([]),
    );

    expect(response.ok).toBe(false);
    expect(response.code).toBe(501);
    expect(response.id).toBe('req-x');
    if (!response.ok) {
      expect(isContractMismatch(response.cause)).toBe(true);
      expect(response.cause).toContain('/unknown_event');
    }
  });

  test('핸들러 부재도 같은 계약 불일치다', async () => {
    const response = await processRequest(
      '/unhandled_event',
      { id: 'req-y', body: {} },
      z.object({}),
      undefined,
    );

    expect(response.ok).toBe(false);
    expect(response.code).toBe(501);
    if (!response.ok) expect(isContractMismatch(response.cause)).toBe(true);
  });

  test('페이로드 검증 실패는 계약 불일치가 아니다 — 되감기 대상이 아님', async () => {
    const response = await processRequest(
      EVENT,
      { id: 'req-z', body: { amount: 'not-a-number' } },
      z.object({ amount: z.number() }),
      okHandler([]),
    );

    expect(response.code).toBe(400);
    if (!response.ok) expect(isContractMismatch(response.cause)).toBe(false);
  });

  test('핸들러가 던진 예외는 계약 불일치가 아니다 — 재시도 대상', async () => {
    const boom = (async () => {
      throw new Error('boom');
    }) as any;
    const response = await processRequest(
      EVENT,
      { id: 'req-w', body: {} },
      z.object({}),
      boom,
    );

    expect(response.code).toBe(500);
    if (!response.ok) expect(isContractMismatch(response.cause)).toBe(false);
  });
});
