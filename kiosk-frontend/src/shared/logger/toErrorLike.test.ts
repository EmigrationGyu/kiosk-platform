import { describe, expect, test } from 'bun:test';
import { toErrorLike } from './toErrorLike';

describe('toErrorLike', () => {
  test('Error 는 name·message·stack 을 그대로 옮긴다', () => {
    const error = new TypeError('무언가 잘못됨');
    const like = toErrorLike(error);
    expect(like.name).toBe('TypeError');
    expect(like.message).toBe('무언가 잘못됨');
    expect(like.stack).toBeTruthy();
  });

  test('트랜스포트 실패 `{cause, code}` 는 사유가 메시지 자리로 온다', () => {
    // socket/ipc 구현이 reject({cause, code}) 로 던진다. 예전엔 호출부가 이걸 감싸
    // "[object Object]" 로 만들어 진단이 통째로 사라졌다.
    expect(toErrorLike({ cause: 'BAD_REQUEST', code: 400 })).toEqual({
      name: undefined,
      message: 'BAD_REQUEST',
      code: 400,
      cause: 'BAD_REQUEST',
    });
  });

  test('message 가 있으면 그쪽이 우선한다', () => {
    const like = toErrorLike({ message: '본문', cause: '사유', code: 'E1' });
    expect(like.message).toBe('본문');
    expect(like.code).toBe('E1');
  });

  test('모르는 객체는 JSON 으로라도 남긴다', () => {
    expect(toErrorLike({ a: 1 }).message).toBe('{"a":1}');
  });

  test('순환 참조는 표식으로 대체한다 (로그가 터지면 안 된다)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toErrorLike(circular).message).toBe('[unserializable object]');
  });

  test('문자열·nullish·원시값', () => {
    expect(toErrorLike('그냥 문자열').message).toBe('그냥 문자열');
    expect(toErrorLike(null).message).toBe('Unknown error');
    expect(toErrorLike(undefined).message).toBe('Unknown error');
    expect(toErrorLike(404).message).toBe('404');
  });
});
