import { processManager } from '@processManager/Manager';
import expressIpc from 'express-ipc';
import { type SerialportProcess, serialportPipePath } from 'kiosk-types';
import {
  REQUEST_TIMEOUT_MS,
  spawnConnectTimeoutMs,
} from 'src/constant/timeouts';
import type { ProcessHandle } from 'src/processManager/types';
import { fromError } from 'zod-validation-error';
import type {
  EventMap,
  ITransport,
  RequestArgs,
  ResponseSchemaMap,
} from '../types';

type SuccessResponse<T> = {
  result: T;
  id: string;
  code: number;
  ok: true;
};

type ErrorResponse = {
  cause: string;
  id: string;
  code: number;
  ok: false;
};

const DEFAULT_RETRY = 0;

export class Transport<M extends EventMap = EventMap> implements ITransport<M> {
  private client: expressIpc.Client | null = null;
  private readonly process: SerialportProcess;
  /** 이 환경의 주소 지정 방식 — 식별자에서 파생한다. */
  private readonly pipePath: string;
  private readonly timeout: number;
  private readonly retry: number;
  private readonly schemaMap: ResponseSchemaMap<M>;

  // 재연결 상태
  private reconnectAttempts = 0;
  private readonly baseDelay = 250; // ms
  private readonly maxDelay = 5000; // ms
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** 지금 붙어 있는 자식 세대. 바뀌면 클라이언트를 새로 만든다. */
  private wiredHandle: ProcessHandle<null> | null = null;

  protected constructor(
    process: SerialportProcess,
    schemaMap: ResponseSchemaMap<M>,
    options?: { timeout?: number; retry?: number },
  ) {
    this.process = process;
    this.pipePath = serialportPipePath(process);
    this.schemaMap = schemaMap;
    this.timeout = options?.timeout ?? REQUEST_TIMEOUT_MS;
    this.retry = options?.retry ?? DEFAULT_RETRY;
    // 연결은 첫 요청 때 — 그 시점에 processManager 가 자식을 띄운다(lazy).
  }

  // 연결 관리

  private createClient() {
    try {
      this.client = new expressIpc.Client({ path: this.pipePath });
    } catch (error) {
      this.handleDisconnect();
      return;
    }

    const client = this.client;
    if (!client) {
      this.handleDisconnect();
      return;
    }

    client.on('error', (err: unknown) => {
      console.error(
        `[IPC:${this.pipePath}] client error:`,
        err instanceof Error ? err.message : err,
      );
      this.handleDisconnect();
    });
    client.on('socket_error', (err: unknown) => {
      console.error(
        `[IPC:${this.pipePath}] socket error:`,
        err instanceof Error ? err.message : err,
      );
      this.handleDisconnect();
    });
  }

  private resetBackoff() {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleDisconnect() {
    if (this.stopped) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    const attempt = this.reconnectAttempts;
    const delay = Math.min(
      this.maxDelay,
      this.baseDelay * Math.pow(2, attempt),
    );
    const jitter = Math.floor(Math.random() * this.baseDelay);
    const timeout = Math.min(this.maxDelay, delay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;

      this.reconnectAttempts += 1;

      try {
        this.destroyCurrentClient();
        this.createClient();
      } catch {
        this.scheduleReconnect();
      }
    }, timeout);
  }

  private destroyCurrentClient() {
    if (this.client) {
      try {
        this.client.close();
      } catch {
        // cleanup 중 에러는 의도적으로 무시
      }
      this.client = null;
    }
  }

  public destroy() {
    this.stopped = true;
    this.resetBackoff();
    this.destroyCurrentClient();
  }

  public reconnect() {
    this.resetBackoff();
    this.stopped = false;
    this.destroyCurrentClient();
    this.createClient();
  }

  // ITransport 구현

  public withTimeout(timeout: number): ITransport<M> {
    return new Transport<M>(this.process, this.schemaMap, {
      timeout,
      retry: this.retry,
    });
  }

  public withRetry(retry: number): ITransport<M> {
    return new Transport<M>(this.process, this.schemaMap, {
      timeout: this.timeout,
      retry,
    });
  }

  /**
   * 자식이 살아있게 만들고, 그 세대에 클라이언트를 붙인다.
   *
   * 자식이 죽으면(회수·크래시) 이 세대는 끝이므로 재연결을 멈춘다 — 안 멈추면 회수된
   * 프로세스를 향해 백오프 재연결이 영원히 돈다. 다음 요청이 다시 띄운다.
   */
  private ensureSpawned(): void {
    const handle = processManager.ensure(this.process);
    if (handle === this.wiredHandle) return;

    this.wiredHandle = handle;
    this.resetBackoff();
    this.destroyCurrentClient();

    handle.onExit(() => {
      if (this.wiredHandle !== handle) return;
      this.wiredHandle = null;
      this.destroy();
    });

    handle.ready.then(() => {
      if (this.wiredHandle !== handle) return;
      this.stopped = false;
      this.createClient();
    });
  }

  public request<E extends keyof M & string>(
    _event: E,
    ...args: RequestArgs<M[E]['request']>
  ): Promise<M[E]['response']> {
    this.ensureSpawned();
    // 재시도까지 한 번의 in-flight 로 센다 — 회수 판정이 재시도 사이 틈에 끼어들지 않는다.
    processManager.markRequestStart(this.process);
    return this.requestWithRetry(_event, args, 0)
      .then((result) => {
        processManager.markRequestEnd(this.process, 'answered');
        return result;
      })
      .catch((error: unknown) => {
        // 여기선 에러 **응답**도 reject 로 온다. 봉투가 온 것(`{cause, code}`)과 아예
        // 답이 없는 것(타임아웃 = Error)을 형태로 가른다 — 전자는 서브프로세스가 살아서
        // 자기 코드를 돌렸다는 증거다.
        const answered =
          typeof error === 'object' && error !== null && 'code' in error;
        processManager.markRequestEnd(
          this.process,
          answered ? 'answered' : 'unanswered',
        );
        throw error;
      });
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

      const schema = this.schemaMap[event as keyof typeof this.schemaMap];
      if (!schema) {
        reject(new Error(`Schema for event ${event} not found`));
        return;
      }

      const data = args[0] as M[E]['request'] | undefined;
      const payload = { id, body: data };

      if (!this.client) {
        // 클라이언트 연결 대기: 재연결 진행 중일 수 있으므로 즉시 throw하지 않고
        // baseDelay 간격으로 폴링하며, timeout 내에 연결되지 않으면 reject한다.
        const waitStart = Date.now();
        const pollForClient = () => {
          if (this.client) {
            this.requestWithRetry(_event, args, attempt)
              .then(resolve)
              .catch(reject);
          } else if (
            Date.now() - waitStart >
            spawnConnectTimeoutMs(this.process)
          ) {
            reject(
              new Error(`IPC client connection timeout: ${this.pipePath}`),
            );
          } else {
            setTimeout(pollForClient, this.baseDelay);
          }
        };
        setTimeout(pollForClient, this.baseDelay);
        return;
      }

      const client = this.client;

      timeoutId = setTimeout(() => {
        if (attempt < this.retry) {
          this.requestWithRetry(_event, args, attempt + 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Request ${event} timeout`));
        }
      }, this.timeout);

      client
        .post<SuccessResponse<M[E]['response']> | ErrorResponse>(event, {
          body: payload,
        })
        .then(
          async (raw: {
            headers: object;
            body: SuccessResponse<M[E]['response']> | ErrorResponse;
          }) => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            const response = raw.body;

            if (response.ok) {
              // parse 결과를 그대로 사용해야 스키마의 strip/default/transform 이 적용된다
              let parsed: M[E]['response'];
              try {
                parsed = (await schema.parseAsync(
                  response.result,
                )) as M[E]['response'];
              } catch (error) {
                const validationError = fromError(error);
                reject({
                  cause: `zod validation error: ${validationError.toString()}`,
                  code: 400,
                });
                return;
              }
              this.resetBackoff();
              resolve(parsed);
            } else {
              reject({ cause: response.cause, code: response.code });
            }
          },
        )
        .catch((error: unknown) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          // 네트워크/IPC 오류: 재연결 시도
          this.handleDisconnect();
          if (attempt < this.retry) {
            this.requestWithRetry(_event, args, attempt + 1)
              .then(resolve)
              .catch(reject);
          } else {
            reject({
              cause: `ipc error: ${error instanceof Error ? error.message : String(error)}`,
              code: 500,
            });
          }
        });
    });
  }
}
