import type { Socket } from 'socket.io-client';
import { fromError } from 'zod-validation-error';
import type {
  EventMap,
  ITransport,
  RequestArgs,
  ResponseSchemaMap,
} from '@/shared/types/transport';
import { createSocket } from '../../socket/Socket';

type SocketSuccessResponse<T> = {
  result: T;
  id: string;
  code: number;
  ok: true;
};

type SocketErrorResponse = {
  cause: string;
  id: string;
  code: number;
  ok: false;
};

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRY = 0;

export class Transport<M extends EventMap = EventMap> implements ITransport<M> {
  private readonly socket: Socket;
  private readonly timeout: number;
  private readonly retry: number;
  private readonly namespace: string;
  private readonly schemaMap: ResponseSchemaMap<M>;

  protected constructor(
    namespace: string,
    schemaMap: ResponseSchemaMap<M>,
    options?: { timeout?: number; retry?: number },
  ) {
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    this.retry = options?.retry ?? DEFAULT_RETRY;
    this.namespace = namespace;
    this.schemaMap = schemaMap;
    this.socket = createSocket().socket(namespace);
  }

  public withTimeout(timeout: number): ITransport<M> {
    return new Transport<M>(this.namespace, this.schemaMap, {
      timeout,
      retry: this.retry,
    });
  }

  public withRetry(retry: number): ITransport<M> {
    return new Transport<M>(this.namespace, this.schemaMap, {
      timeout: this.timeout,
      retry,
    });
  }

  public request<E extends keyof M & string>(
    _event: E,
    ...args: RequestArgs<M[E]['request']>
  ): Promise<M[E]['response']> {
    return this.requestWithRetry(_event, args, 0);
  }

  private requestWithRetry<E extends keyof M & string>(
    _event: E,
    args: RequestArgs<M[E]['request']>,
    attempt: number,
  ): Promise<M[E]['response']> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let event = _event as string;
      if (!event.startsWith('/')) {
        event = `/${event}`;
      }
      const callback = async (
        response: SocketSuccessResponse<M[E]['response']> | SocketErrorResponse,
      ) => {
        if (response.id !== id) {
          return;
        }

        // 일치하는 응답을 받으면 즉시 리스너 해제해 누적을 방지.
        // (reject 경로 포함 어떤 경로든 해제·타이머 정리가 선행되어야
        // 타임아웃 발화로 인한 유령 재시도가 생기지 않는다.)
        this.socket.off(event, callback);

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const schema = this.schemaMap[event as keyof typeof this.schemaMap];
        if (!schema) {
          reject(new Error(`Schema for event ${event} not found`));
          return;
        }

        if (response.ok) {
          // parse 결과를 그대로 사용해야 스키마의 strip/default/transform 이 적용된다
          let parsed: M[E]['response'];
          try {
            parsed = (await schema.parseAsync(
              response.result,
            )) as M[E]['response'];
          } catch (error) {
            const validationError = fromError(error);
            reject(validationError.toString());
            return;
          }

          resolve(parsed);
        } else {
          reject({ cause: response.cause, code: response.code });
          return;
        }
      };
      this.socket.on(event, callback);
      const data = args[0] as M[E]['request'] | undefined;
      const payload = {
        id,
        body: data,
      } as { id: string; body: M[E]['request'] | undefined };
      timeoutId = setTimeout(() => {
        this.socket.off(event, callback);
        if (attempt < this.retry) {
          this.requestWithRetry(_event, args, attempt + 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Request ${event} timeout`));
        }
      }, this.timeout);
      this.socket.emit(event, payload);
    });
  }
}
