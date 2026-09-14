import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  okSchema,
  resultSchema,
  resultSchemaOf,
  resultVoidSchema,
  resultVoidSchemaOf,
} from './result';

const Cause = z.enum(['TIMEOUT', 'JAM']);
const Data = z.object({ id: z.string() });

/**
 * Result 패턴 코어 헬퍼 — 모든 하드웨어/이벤트 응답의 계약.
 * 가치 포인트: success discriminator 분기, 성공=data 동반, 실패=cause+code,
 * 그리고 *Of 버전이 cause 를 임의 string 이 아닌 도메인 enum 으로 좁히는지.
 */
describe('resultSchemaOf — Result 형태 + cause enum narrowing', () => {
  const schema = resultSchemaOf(Data, Cause);

  test('success: data 동반 시 통과', () => {
    expect(schema.safeParse({ success: true, data: { id: 'x' } }).success).toBe(
      true,
    );
  });

  test('success: data 누락 거절', () => {
    expect(schema.safeParse({ success: true }).success).toBe(false);
  });

  test('failure: enum 안 cause + code 통과', () => {
    expect(
      schema.safeParse({ success: false, cause: 'TIMEOUT', code: 1 }).success,
    ).toBe(true);
  });

  test('failure: enum 밖 cause 거절 (임의 string 불허 — narrowing 핵심)', () => {
    expect(
      schema.safeParse({ success: false, cause: 'BOOM', code: 1 }).success,
    ).toBe(false);
  });

  test('failure: code 누락 거절', () => {
    expect(schema.safeParse({ success: false, cause: 'JAM' }).success).toBe(
      false,
    );
  });

  test('success discriminator 누락 거절', () => {
    expect(schema.safeParse({ data: { id: 'x' } }).success).toBe(false);
  });
});

describe('resultSchema — causeSchema 없는 버전은 임의 string cause 허용', () => {
  const schema = resultSchema(Data);

  test('failure: 임의 string cause + int code 통과', () => {
    expect(
      schema.safeParse({ success: false, cause: 'anything', code: 0 }).success,
    ).toBe(true);
  });

  test('failure: code 가 정수 아니면 거절', () => {
    expect(
      schema.safeParse({ success: false, cause: 'x', code: 1.5 }).success,
    ).toBe(false);
  });

  test('ok: data 필수', () => {
    expect(schema.safeParse({ success: true }).success).toBe(false);
  });
});

describe('void 버전 — data 없는 성공', () => {
  test('resultVoidSchema: {success:true} 통과 (data 불요)', () => {
    expect(resultVoidSchema.safeParse({ success: true }).success).toBe(true);
  });

  test('resultVoidSchemaOf: enum 안 cause 통과 / 밖 거절', () => {
    const schema = resultVoidSchemaOf(Cause);
    expect(
      schema.safeParse({ success: false, cause: 'TIMEOUT', code: 2 }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ success: false, cause: 'NOPE', code: 2 }).success,
    ).toBe(false);
  });
});

describe('okSchema', () => {
  test('{success:true, data} 형태로 감쌈', () => {
    const schema = okSchema(Data);
    expect(schema.safeParse({ success: true, data: { id: 'a' } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ success: true }).success).toBe(false);
  });
});
