import { processManager as targetManager } from '@processManager/Manager';
import { isContractMismatch, type SerialportProcess } from 'kiosk-types';
import {
  REQUEST_TIMEOUT_MS,
  spawnConnectTimeoutMs,
} from 'src/constant/timeouts';
import type { ProcessManager } from 'src/processManager/types';
import { promotionJudge } from 'src/update/judgeInstance';
import { contractWitness } from 'src/update/witnessInstance';
import { fromError } from 'zod-validation-error';
import { createReadyGate, type ReadyGate } from '../readyGate';
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

/**
 * 이 트랜스포트가 요구하는 채널 모양. postMessage 로 말하는 타깃(electron·bridge)에서만
 * 쓰이며, 어느 매니저가 실릴지는 빌드 타깃 표(esbuild IMPL)가 보장한다. tsconfig 는
 * 타입체크용으로 node impl(채널 없음)을 가리키므로 여기서 한 번 좁힌다.
 */
type MessageChannel = {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (value: unknown) => void): void;
  off(event: 'message', listener: (value: unknown) => void): void;
};

const processManager =
  targetManager as unknown as ProcessManager<MessageChannel>;

const DEFAULT_RETRY = 0;

export class Transport<M extends EventMap = EventMap> implements ITransport<M> {
  private readonly process: SerialportProcess;
  private readonly timeout: number;
  private readonly retry: number;
  private readonly schemaMap: ResponseSchemaMap<M>;
  /** 세대별 준비 게이트 — 준비 전 요청은 여기서 기다렸다 재진입한다. */
  private readonly gate: ReadyGate;

  protected constructor(
    process: SerialportProcess,
    schemaMap: ResponseSchemaMap<M>,
    options?: { timeout?: number; retry?: number },
  ) {
    this.process = process;
    this.schemaMap = schemaMap;
    this.gate = createReadyGate(spawnConnectTimeoutMs(process), process);
    this.timeout = options?.timeout ?? REQUEST_TIMEOUT_MS;
    this.retry = options?.retry ?? DEFAULT_RETRY;
  }

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

      const schema = this.schemaMap[event as keyof typeof this.schemaMap];
      if (!schema) {
        reject(new Error(`Schema for event ${event} not found`));
        return;
      }

      // 살아있지 않으면 여기서 띄운다. spawn 실패는 throw 되어 이 Promise 의 reject 가 된다.
      const handle = processManager.ensure(this.process);

      // 아직 말할 수 없는 세대면 **요청 시계를 걸지 않고** 기다렸다 재진입한다.
      // 채널이 버퍼링해 주더라도 시계는 그대로 돌기 때문에, 이 분기가 없으면 콜드
      // 부팅 시간이 요청 예산을 갉아먹는다(express-ipc impl 과 같은 구분).
      if (!this.gate.isReady(handle)) {
        this.gate
          .wait(handle)
          .then(() => this.requestWithRetry(_event, args, attempt))
          .then(resolve, reject);
        return;
      }

      const { channel } = handle;

      const data = args[0] as M[E]['request'] | undefined;
      const payload = { id, event, body: data };
      console.log(
        `[Transport] request() event=${event} id=${id} body=${JSON.stringify(data)}`,
      );

      const callback = async (value: unknown) => {
        const response = value as
          | SuccessResponse<M[E]['response']>
          | ErrorResponse;

        if (response.id !== id) {
          return;
        }

        // 일치하는 응답을 받으면 즉시 리스너 해제해 누적을 방지
        channel.off('message', callback);

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // in-flight 감소 — 응답을 받았으니 이 요청은 더 이상 프로세스를 점유하지 않는다.
        // (idle reaper 가 in-flight=0 일 때만 종료하므로 균형이 중요.)
        // 봉투가 돌아왔다 — 내용이 실패여도 서브프로세스는 살아서 자기 코드를 돌렸다.
        processManager.markRequestEnd(this.process, 'answered');
        // 봉투에 실린 표면 지문을 관측한다 — 이 장치와 말이 통하는지의 근거다.
        // (total 이 아니라 자기 표면이다 — 무관한 계약 변경이 이 장치를 되감게 하지 않는다.)
        contractWitness.observe(
          this.process,
          (value as { surface?: unknown }).surface,
        );
        // 모르는 이벤트에 대한 응답은 지문과 무관하게 조합이 어긋났다는 뜻이다.
        if (!response.ok && isContractMismatch(response.cause)) {
          contractWitness.reject(this.process);
        }
        // 관측이 갱신됐으니 승격/되감기 판정을 다시 본다 — 장치는 지연 spawn 이라
        // 홈 진입 시점엔 아직 접촉되지 않았을 수 있다.
        promotionJudge.deviceAnswered(this.process);

        if (response.ok) {
          console.log(`[Transport] response ok event=${event} id=${id}`);
          // parse 결과를 그대로 사용해야 스키마의 strip/default/transform 이 적용된다
          let parsed: M[E]['response'];
          try {
            parsed = (await schema.parseAsync(
              response.result,
            )) as M[E]['response'];
          } catch (error) {
            const validationError = fromError(error);
            console.error(
              `[Transport] response validation error event=${event} id=${id}: ${validationError.toString()}`,
            );
            reject({
              cause: `zod validation error: ${validationError.toString()}`,
              code: 400,
            });
            return;
          }
          resolve(parsed);
        } else {
          console.error(
            `[Transport] response error event=${event} id=${id} code=${response.code} cause=${response.cause}`,
          );
          reject({ cause: response.cause, code: response.code });
        }
      };

      channel.on('message', callback);

      timeoutId = setTimeout(() => {
        channel.off('message', callback);
        // 응답 없이 타임아웃 — 이 시도의 in-flight 도 해제한다(재시도는 새 start 를 찍는다).
        processManager.markRequestEnd(this.process, 'unanswered');
        console.error(
          `[Transport] request TIMEOUT event=${event} id=${id} attempt=${attempt}/${this.retry}`,
        );
        if (attempt < this.retry) {
          this.requestWithRetry(_event, args, attempt + 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Request ${event} timeout`));
        }
      }, this.timeout);

      // 요청 송신 직전 in-flight 증가 + 활동시각 갱신 — reaper 가 이 프로세스를
      // idle 로 오인해 종료하지 못하도록(특히 카드결제 같은 장시간 대기 요청).
      processManager.markRequestStart(this.process);
      channel.postMessage(payload);
    });
  }
}
