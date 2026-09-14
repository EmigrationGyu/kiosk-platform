export type { EventMap } from 'kiosk-types';

import type { EventMap } from 'kiosk-types';

export type ResponseSchemaMap<M extends EventMap> = {
  [E in keyof M & string]: import('zod').ZodSchema<M[E]['response']>;
};

/**
 * request payload가 "완전히 optional"이면 request 인자 자체를 생략 가능하게 만든다.
 * - void/undefined는 기본적으로 생략 가능
 * - 객체 타입에서 필수 키(required key)가 하나도 없으면 생략 가능
 */
type RequiredKeys<T> = T extends object
  ? {
      [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
    }[keyof T]
  : never;

type IsOptionalRequest<T> = [T] extends [void]
  ? true
  : undefined extends T
    ? true
    : T extends object
      ? RequiredKeys<T> extends never
        ? true
        : false
      : false;

export type RequestArgs<T> =
  IsOptionalRequest<T> extends true ? [data?: T] : [data: T];

export interface ITransport<M extends EventMap = EventMap> {
  withTimeout(timeout: number): ITransport<M>;
  withRetry(retry: number): ITransport<M>;

  /**
   * 타입 안전한 요청 메서드
   * - 존재하는 이벤트만 허용
   * - 이벤트에 맞는 파라미터만 허용 (void면 생략 가능, undefined 전달도 허용)
   * - 이벤트에 맞는 리턴 타입을 Promise로 반환
   */
  request<E extends keyof M & string>(
    event: E,
    ...args: RequestArgs<M[E]['request']>
  ): Promise<M[E]['response']>;
}
