import { Server } from 'express-ipc';
import { CONTRACT_TOTAL } from 'kiosk-types';
import type { z } from 'zod';
import { fromError } from 'zod-validation-error';
import { ownSurface } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import type {
  ControllerHandlers,
  EventMap,
  HandlerError,
  HandlerSuccess,
  IRouter,
} from '../types';

/**
 * 개발용 Router: express-ipc Server 기반 Named Pipe 통신.
 *
 * 프로토콜 (백엔드 Channel과 동일):
 *   요청: { id: string, body: T }
 *   응답: { id, ok: true,  code, result } | { id, ok: false, code, cause }
 */
export class Router<M extends EventMap> implements IRouter<M> {
  private readonly urlSet: Set<string> = new Set();
  private readonly handlers = new Map<
    string,
    ControllerHandlers<M>[Extract<keyof M, string>]
  >();
  private readonly basePath: string;
  private readonly server: Server;
  private readonly schemas: Record<string, z.ZodSchema>;

  constructor(basePath: string, schemas: Record<string, z.ZodSchema>) {
    this.basePath = basePath;
    this.schemas = schemas;
    this.server = new Server();
    this.server.listen({
      path: this.basePath,
      deleteSocketBeforeListening: true,
    });
  }

  private serve<K extends Extract<keyof M, string>>(
    url: K,
    handler: ControllerHandlers<M>[K],
  ) {
    if (this.urlSet.has(url)) {
      throw new Error(`URL ${String(url)} already served`);
    }
    this.urlSet.add(url);
    this.handlers.set(url, handler);

    const surface = ownSurface();

    this.server.post(url, async ({ req, res }: any) => {
      const reply = (envelope: Record<string, unknown>): void =>
        res.send({ ...envelope, contract: CONTRACT_TOTAL, surface });
      let id: string | undefined;
      try {
        const payload = req.body as { id: string; body: M[K]['request'] };
        id = payload.id;
        const body = payload.body;

        // Zod 요청 검증 — parse 결과를 핸들러에 전달해야
        // 스키마의 strip/default/transform 이 실제로 적용된다
        let parsedBody: M[K]['request'] = body;
        const schema = this.schemas[url];
        if (schema) {
          try {
            parsedBody = (await schema.parseAsync(body)) as M[K]['request'];
          } catch (e) {
            const validationError = fromError(e);
            reply({
              id,
              ok: false,
              code: 400,
              cause: validationError.toString(),
            });
            return;
          }
        }

        // 핸들러 디스패치 — Map에서 동적 조회하여 HMR 시 교체된 핸들러 반영
        const responseHelper: any = {
          ok: (code: number, data: any) => ({ success: true, code, data }),
          error: (code: number, cause: string) => ({
            success: false,
            code,
            cause,
          }),
        };

        const currentHandler = this.handlers.get(url)!;
        const result: HandlerSuccess<any> | HandlerError = await currentHandler(
          parsedBody,
          responseHelper,
        );

        if (result.success) {
          reply({
            id,
            ok: true,
            code: result.code,
            result: result.data,
          });
        } else {
          reply({
            id,
            ok: false,
            code: result.code,
            cause: result.cause,
          });
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        Logger.getInstance().error('[IPC] unhandled error', e, {
          unmasked: { url, id: id ?? 'unknown', error: errorMessage },
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
      this.serve(url, handlers[url]);
    }
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
