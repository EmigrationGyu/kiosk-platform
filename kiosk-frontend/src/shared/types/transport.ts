export type {
  ControllerHandlers,
  EventMap,
  Handler,
  HandlerError,
  HandlerResponse,
  HandlerSuccess,
  IRouter,
  MaybePromise,
} from 'kiosk-types';

// Frontend-specific transport types (not in kiosk-types)
export type ResponseSchemaMap<M extends import('kiosk-types').EventMap> = {
  [E in keyof M & string]: import('zod').ZodSchema<M[E]['response']>;
};

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

export interface ITransport<
  M extends import('kiosk-types').EventMap = import('kiosk-types').EventMap,
> {
  withTimeout(timeout: number): ITransport<M>;
  withRetry(retry: number): ITransport<M>;
  request<E extends keyof M & string>(
    event: E,
    ...args: RequestArgs<M[E]['request']>
  ): Promise<M[E]['response']>;
}
