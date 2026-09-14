import type { ErrorLike } from './types';

/**
 * 던져진 아무 값 → 로그로 보낼 `ErrorLike`.
 *
 * **호출부가 감싸지 않아도 되는 것이 요점이다.** 트랜스포트는 `Error` 가 아니라
 * `{ cause, code }` 객체를 던지는데(socket/ipc 구현의 reject), 호출부가 이걸
 * `new Error(String(error))` 로 감싸면 메시지가 `[object Object]` 가 되어 진단이
 * 통째로 사라진다. 그래서 정규화는 여기 한 곳에서만 하고, 호출부는 받은 값을 **그대로**
 * `logger.error(message, error)` 에 넘긴다.
 *
 * 인식하는 모양(위에서부터):
 *   1. `Error`                    — name/message/stack 그대로
 *   2. `{ message }`              — Error 유사 객체
 *   3. `{ cause, code }`          — 트랜스포트 실패(사유가 message 자리로)
 *   4. 그 외 객체                 — JSON 직렬화(불가하면 표식)
 *   5. 문자열·null·나머지 원시값
 */
export const toErrorLike = (error: unknown): ErrorLike => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const code =
      typeof obj.code === 'string' || typeof obj.code === 'number'
        ? obj.code
        : undefined;

    if ('message' in obj) {
      return {
        name: typeof obj.name === 'string' ? obj.name : undefined,
        message: String(obj.message),
        stack: typeof obj.stack === 'string' ? obj.stack : undefined,
        code,
      };
    }

    // 트랜스포트 실패 — 사유가 유일한 정보다. 메시지 자리에 올려 로그에서 바로 읽히게.
    if (typeof obj.cause === 'string') {
      return {
        name: typeof obj.name === 'string' ? obj.name : undefined,
        message: obj.cause,
        code,
        cause: obj.cause,
      };
    }

    try {
      return { message: JSON.stringify(error), code };
    } catch {
      return { message: '[unserializable object]', code };
    }
  }

  if (typeof error === 'string') return { message: error };
  if (error === null || error === undefined)
    return { message: 'Unknown error' };
  return { message: String(error) };
};
