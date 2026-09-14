import { CONTRACT_TOTAL, contractMismatchCause } from 'kiosk-types';
import type { z } from 'zod';
import { fromError } from 'zod-validation-error';
import { ownSurface } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import type {
  ControllerHandlers,
  EventMap,
  HandlerError,
  HandlerResponse,
  HandlerSuccess,
  IRouter,
} from '../types';

/**
 * 메시지 채널 하나 — 봉투를 보내고 받는다. 어느 채널인지는 모른다: `parentPort`(electron
 * utilityProcess)든 `process.send`(child_process IPC)든 이 모양으로 보이면 된다.
 * **언랩 차이는 accessor 가 흡수한다** — parentPort 는 `{ data }` 로 감싸고 node IPC 는 원본을 준다.
 */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  onMessage(listener: (data: unknown) => void): void;
}

/**
 * 메시지 채널 Router 의 **토폴로지 중립 코어**. 프로토콜은 백엔드 Channel 과 동일하다:
 *   요청 `{ id, event, body }` · 응답 `{ id, ok: true, code, result } | { id, ok: false, code, cause }`
 *
 * 여기 있는 것은 전부 채널과 무관하다 — Zod 검증 · 핸들러 디스패치 · 계약 지문 · 에러 매핑. 채널을 아는
 * 것은 하위 클래스의 `connect()` 뿐이라, 새 호스트는 accessor 하나만 만들면 된다.
 *
 * 네임드 파이프(express-ipc)는 이 코어를 공유하지 않는다 — URL 라우팅과 서버 수명이라 구조가 다르고,
 * 그쪽은 개발 전용으로 격리돼 있다.
 */
export abstract class MessageRouter<M extends EventMap> implements IRouter<M> {
  private readonly handlers = new Map<
    string,
    ControllerHandlers<M>[Extract<keyof M, string>]
  >();
  private readonly schemas: Record<string, z.ZodSchema>;
  private listenerInitialized = false;

  constructor(_basePath: string, schemas: Record<string, z.ZodSchema>) {
    this.schemas = schemas;
    // basePath 는 express-ipc impl 과의 생성자 시그니처 통일을 위해 받는다.
    // 메시지 채널에는 주소가 없다 — 부모가 이미 이 자식과 연결된 채로 띄운다.
  }

  /** 이 토폴로지에서 부모와 이어진 채널. 없으면 던진다 — 배선이 어긋난 것이다. */
  protected abstract connect(): MessagePortLike;

  private initListener() {
    if (this.listenerInitialized) return;
    this.listenerInitialized = true;

    const port = this.connect();

    /**
     * 응답 봉투에 이 프로세스의 지문을 싣는다. `surface`(자기 프로세스 표면)가 백엔드의 일치 판정
     * 근거다 — total 로 판정하면 무관한 계약 변경이 이 장치를 되감게 만든다(total 은 로그·진단용 병행).
     * 여기 한 곳에 달면 모든 장치가 자동으로 얻고 `bun gen bs` 로 만들 새 장치도 따라온다.
     */
    const surface = ownSurface();
    const reply = (envelope: Record<string, unknown>): void =>
      port.postMessage({ ...envelope, contract: CONTRACT_TOTAL, surface });

    port.onMessage(async (data: unknown) => {
      const msg = data as {
        id: string;
        event: string;
        body: unknown;
      };
      const { id, event, body } = msg;
      Logger.getInstance().info('[Router] received', {
        unmasked: { event, id },
      });

      const handler = this.handlers.get(event);
      if (!handler) {
        Logger.getInstance().error('[Router] no handler', undefined, {
          unmasked: { event },
        });
        // 표식을 실어야 백엔드가 이걸 **계약 불일치**로 읽는다 — 지문을 싣지 않는 옛
        // 산출물은 지문 대조로는 안 잡히고 이 응답만이 유일한 증거다.
        reply({
          id,
          ok: false,
          code: 404,
          cause: contractMismatchCause(`No handler for event: ${event}`),
        });
        return;
      }

      try {
        // Zod 요청 검증 — parse 결과를 핸들러에 전달해야
        // 스키마의 strip/default/transform 이 실제로 적용된다
        let parsedBody: unknown = body;
        const schema = this.schemas[event];
        if (schema) {
          try {
            parsedBody = await schema.parseAsync(body);
          } catch (err) {
            const validationError = fromError(err);
            reply({
              id,
              ok: false,
              code: 400,
              cause: validationError.toString(),
            });
            return;
          }
        }

        // 핸들러 디스패치. 헬퍼를 `any` 로 두면 이 리터럴이 계약을 만족하는지 아무도 안 보고, 나중에
        // `HandlerResponse` 에 항목이 늘어도 여기가 조용히 낡는다. 그래서 헬퍼는
        // `HandlerResponse<unknown>` 으로 붙잡고 **캐스트는 넘기는 한 곳에만** 둔다 — 이 자리의 핸들러는
        // 맵에서 꺼낸 유니온이라 응답 타입을 알 수 없고, 그 좁힘은 컨트롤러의 satisfies 가 이미 한다.
        const responseHelper: HandlerResponse<unknown> = {
          ok: (code: number, data?: unknown) => ({ success: true, code, data }),
          error: (code: number, cause: string) => ({
            success: false,
            code,
            cause,
          }),
        };

        const result: HandlerSuccess<unknown> | HandlerError = await handler(
          parsedBody,
          responseHelper as never,
        );

        if (result.success) {
          Logger.getInstance().info('[Router] response ok', {
            unmasked: { event, id, code: result.code },
          });
          reply({
            id,
            ok: true,
            code: result.code,
            result: result.data,
          });
        } else {
          Logger.getInstance().error('[Router] response error', undefined, {
            cause: result.cause,
            unmasked: { event, id, code: result.code },
          });
          reply({
            id,
            ok: false,
            code: result.code,
            cause: result.cause,
          });
        }
      } catch (e) {
        Logger.getInstance().error('[Router] unhandled error', e, {
          unmasked: { event, id },
        });
        reply({
          id,
          ok: false,
          code: 500,
          cause: 'Internal Server Error',
        });
      }
    });
  }

  public serveAll(handlers: ControllerHandlers<M>) {
    for (const url of Object.keys(handlers) as Array<
      Extract<keyof M, string>
    >) {
      if (this.handlers.has(url)) {
        throw new Error(`URL ${String(url)} already served`);
      }
      this.handlers.set(url, handlers[url]);
    }

    // 모든 핸들러 등록 후 리스너 초기화
    this.initListener();
  }

  public replaceHandlers(handlers: ControllerHandlers<M>) {
    for (const [url, handler] of Object.entries(handlers) as Array<
      [
        Extract<keyof M, string>,
        ControllerHandlers<M>[Extract<keyof M, string>],
      ]
    >) {
      if (!this.handlers.has(url)) {
        throw new Error(`Cannot replace unregistered URL: ${String(url)}`);
      }
      this.handlers.set(url, handler);
    }
  }
}
