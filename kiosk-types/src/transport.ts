import type { z } from 'zod';

/** 각 이벤트/엔드포인트의 request/response 타입을 매핑하는 기본 맵 타입 */
export type EventMap = Record<string, { request: unknown; response: unknown }>;

/**
 * EventMap 의 각 이벤트 요청을 검증하는 Zod 스키마 맵.
 * 라우터 생성자 등 수신측에 이 타입을 요구하면 스키마 키 누락/오타/타입 불일치가
 * 런타임(500)이 아닌 컴파일 타임에 잡힌다.
 */
export type RequestSchemaMap<M extends EventMap> = {
  [K in keyof M & string]: z.ZodType<M[K]['request']>;
};

export type HandlerError = {
  success: false;
  code: number;
  cause: string;
};

// response 타입에 따라 data 필수/옵션/금지
export type HandlerSuccess<D = unknown> = [D] extends [never]
  ? never
  : undefined extends D
    ? { success: true; code: number; data?: D }
    : { success: true; code: number; data: D };

export type HandlerResponse<D = unknown> = [D] extends [never]
  ? { ok: never; error: (code: number, cause: string) => HandlerError }
  : undefined extends D
    ? {
        ok: (code: number, data?: D) => HandlerSuccess<D>;
        error: (code: number, cause: string) => HandlerError;
      }
    : {
        ok: (code: number, data: D) => HandlerSuccess<D>;
        error: (code: number, cause: string) => HandlerError;
      };

export type MaybePromise<T> = T | Promise<T>;

export type Handler<TReq = unknown, TRes = unknown> = (
  body: TReq,
  response: HandlerResponse<TRes>,
) => MaybePromise<HandlerSuccess<TRes> | HandlerError>;

export type ControllerHandlers<M extends EventMap> = {
  [K in keyof M & string]: Handler<M[K]['request'], M[K]['response']>;
};

export interface IRouter<M extends EventMap> {
  serveAll(handlers: ControllerHandlers<M>): void;
}
