import {
  isContractMismatch,
  isUpdatePending,
  NAMESPACES,
  PORT_REPLACED_EVENT,
  RENDERER_PORT_MESSAGE,
  UPDATE_EVENTS,
} from 'kiosk-types';
import { fromError } from 'zod-validation-error';
import type {
  EventMap,
  ITransport,
  RequestArgs,
  ResponseSchemaMap,
} from '@/shared/types/transport';

type SuccessResponse<T> = { result: T; id: string; code: number; ok: true };
type ErrorResponse = { cause: string; id: string; code: number; ok: false };

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRY = 0;

/**
 * 백엔드가 교체를 준비하는 동안의 재시도.
 *
 * **이 사유에만** 자동 재시도한다 — 거절이 실행 **전에** 일어나 "확실히 아무 일도 없었다"가
 * 보장되기 때문이다. 포트 교체 503 은 결과 불명이라 자동으로 다시 보내면 안 된다(현금이
 * 두 번 나갈 수 있다).
 *
 * 상한은 교체가 넉넉히 끝나고도 남을 만큼 둔다. 넘으면 실패로 올려 화면이 영영 매달리지
 * 않게 한다 — 그 상황은 이미 업데이트 문제가 아니라 기기 문제다.
 */
const UPDATE_RETRY_DELAY_MS = 1500;
const UPDATE_RETRY_DEADLINE_MS = 60_000;

/**
 * 백엔드 직결 MessagePort 트랜스포트.
 *
 * 백엔드가 electron 메인 밖(자식 프로세스)에서 돌 때 쓰인다. 메인은 배선만 하고 트래픽엔
 * 끼지 않으므로 `ipcRenderer.invoke` 와 달리 메인을 거치지 않는다.
 *
 * **포트는 갈릴 수 있다.** 백엔드가 재기동되면 메인이 새 포트를 보내고 옛 포트는 죽는다 —
 * socket.io 와 달리 MessagePort 는 재연결이 없다. 그래서 진행 중 요청은 실패로 정리하고
 * (응답이 영영 오지 않으므로) 호출부가 재시도하게 둔다.
 */
type Pending = {
  resolve: (value: SuccessResponse<unknown> | ErrorResponse) => void;
  reject: (error: unknown) => void;
};

const pending = new Map<string, Pending>();
/**
 * 포트 도착 전 송신 대기열. 포트가 영영 안 오는 상황(배선 실패)에서 무한히 자라지 않도록
 * 상한을 둔다 — 요청은 타임아웃으로 각자 실패하지만 여기 담긴 메시지는 남기 때문이다.
 */
const OUTBOX_LIMIT = 100;
const outbox: unknown[] = [];
let port: MessagePort | null = null;

function attach(next: MessagePort): void {
  // **교체일 때만** 정리한다. 첫 배선에서 정리하면 아직 보내지도 않고 대기열에 있던
  // 부팅 요청들을 "이전 세대"로 오인해 죽인 뒤 곧바로 flush 하는 꼴이 된다
  // (실측: 매 부팅 토큰 조회·IME ensure 가 이것 때문에 실패했다).
  if (port) {
    // 이전 세대로 보낸 요청은 응답이 오지 않는다 — 매달리지 않게 즉시 정리한다.
    for (const [, waiter] of pending) {
      waiter.reject({ cause: 'backend port replaced', code: 503 });
    }
    pending.clear();
  }

  const replaced = port !== null;
  console.info(
    replaced
      ? '[transport] 백엔드 포트 재연결 — 진행 중 요청은 실패로 정리합니다'
      : '[transport] 백엔드 포트 연결',
  );

  port = next;
  next.onmessage = (event: MessageEvent) => {
    const message = event.data as {
      kind?: string;
      id?: string;
      payload?: unknown;
    };
    if (message?.kind !== 'response' || !message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message.payload as SuccessResponse<unknown> | ErrorResponse);
  };
  next.start();

  for (const queued of outbox) next.postMessage(queued);
  outbox.length = 0;

  if (replaced) {
    // 상대가 갈렸으면 조합도 갈렸을 수 있다 — 옛 조합에서 한 번 보고했다고 새 조합의
    // 불일치를 못 알리면 백스톱이 꺼진 채로 남는다.
    mismatchReported = false;
    // 새 백엔드는 렌더러가 이미 떴다는 사실을 모른다. 소비처가 다시 선언할 수 있도록
    // 알린다(웹 표준 이벤트라 플랫폼에 묶이지 않는다).
    window.dispatchEvent(new Event(PORT_REPLACED_EVENT));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string })?.type !== RENDERER_PORT_MESSAGE) {
      return;
    }
    const next = event.ports?.[0];
    if (next) attach(next);
  });
}

/**
 * 계약 불일치를 백엔드에 되돌려 알린다.
 *
 * 한 번만 보낸다 — 어긋난 조합에서는 요청마다 같은 응답이 오는데, 그때마다 되감기를
 * 요청하면 되감는 중에 또 요청하는 꼴이 된다.
 */
let mismatchReported = false;
function reportContractMismatch(cause: string): void {
  if (mismatchReported) return;
  mismatchReported = true;
  console.error(`[transport] 계약 불일치 — 되감기를 요청합니다: ${cause}`);
  send({
    kind: 'request',
    address: `${NAMESPACES.UPDATE}${UPDATE_EVENTS.CONTRACT_MISMATCH}`,
    id: crypto.randomUUID(),
    body: { cause },
  });
}

/** 포트가 아직 없으면 담아둔다 — 부팅 중 첫 요청이 배선보다 빠를 수 있다. */
function send(message: unknown): void {
  if (port) {
    port.postMessage(message);
    return;
  }
  if (outbox.length >= OUTBOX_LIMIT) {
    console.error(
      '[transport] 백엔드 포트 미배선 상태로 대기열이 가득 찼습니다 — 가장 오래된 요청을 버립니다.',
    );
    outbox.shift();
  }
  outbox.push(message);
}

export class Transport<M extends EventMap = EventMap> implements ITransport<M> {
  private readonly namespace: string;
  private readonly timeout: number;
  private readonly retry: number;
  private readonly schemaMap: ResponseSchemaMap<M>;

  protected constructor(
    namespace: string,
    schemaMap: ResponseSchemaMap<M>,
    options?: { timeout?: number; retry?: number },
  ) {
    this.namespace = namespace;
    this.schemaMap = schemaMap;
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    this.retry = options?.retry ?? DEFAULT_RETRY;
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
    return this.requestWithRetry(
      _event,
      args,
      0,
      Date.now() + UPDATE_RETRY_DEADLINE_MS,
    );
  }

  private requestWithRetry<E extends keyof M & string>(
    _event: E,
    args: RequestArgs<M[E]['request']>,
    attempt: number,
    updateDeadline: number,
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

      const retryOr = (fail: () => void) => {
        if (attempt < this.retry) {
          this.requestWithRetry(_event, args, attempt + 1, updateDeadline)
            .then(resolve)
            .catch(reject);
          return;
        }
        fail();
      };

      timeoutId = setTimeout(() => {
        pending.delete(id);
        retryOr(() => reject(new Error(`Request ${event} timeout`)));
      }, this.timeout);

      pending.set(id, {
        resolve: async (response) => {
          if (timeoutId) clearTimeout(timeoutId);

          // 계약 불일치는 **늦게 드러나는 배포 사고**다. 지문 대조가 놓친 경우(지문을
          // 싣지 않는 옛 산출물 등)에도 여기서 반드시 걸리므로, 조용히 삼키지 않고
          // 백엔드에 알려 되감기가 일어나게 한다.
          if (!response.ok && isContractMismatch(response.cause)) {
            reportContractMismatch(response.cause);
          }

          // 업데이트 대기는 실패가 아니라 "아직"이다 — 조용히 다시 보낸다.
          if (!response.ok && isUpdatePending(response.cause)) {
            if (Date.now() < updateDeadline) {
              setTimeout(() => {
                this.requestWithRetry(_event, args, attempt, updateDeadline)
                  .then(resolve)
                  .catch(reject);
              }, UPDATE_RETRY_DELAY_MS);
              return;
            }
          }

          if (!response.ok) {
            reject({ cause: response.cause, code: response.code });
            return;
          }
          // parse 결과를 그대로 사용해야 스키마의 strip/default/transform 이 적용된다
          try {
            resolve(
              (await schema.parseAsync(response.result)) as M[E]['response'],
            );
          } catch (error) {
            reject({
              cause: `zod validation error: ${fromError(error).toString()}`,
              code: 400,
            });
          }
        },
        reject: (error) => {
          if (timeoutId) clearTimeout(timeoutId);
          retryOr(() => reject(error));
        },
      });

      send({
        kind: 'request',
        address: `${this.namespace}${event}`,
        id,
        body: args[0],
      });
    });
  }
}
