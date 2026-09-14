import { BaseController } from '@/shared/IPCServer/Controller';
import type { ControllerHandlers } from '@/shared/IPCServer/types';
import { Logger } from '@/shared/Logger';
import {
  ENDPOINTS,
  type EndpointsMap,
  OUTBOX_ERROR_CODE,
  type OutboxCause,
} from '../constants/endpoints';
import type { CredentialStore } from '../executor/credentialStore';
import type { OutboxScheduler } from '../scheduler/OutboxScheduler';
import type { OutboxService } from '../service/OutboxService';

export type OutboxControllerDeps = {
  service: OutboxService;
  scheduler: OutboxScheduler;
  credentials: CredentialStore;
};

/**
 * 컨트롤러는 thin wrapper.
 * - CRUD 성격 엔드포인트 → service 위임
 * - DRAIN → scheduler.drainNow() 위임 (픽업 트리거)
 *
 * 핸들러 시그니처(API 규약)는 변경 가능. 도메인 로직은 service / scheduler 가
 * 단일 출처.
 */
export class OutboxController extends BaseController<EndpointsMap> {
  private logger = Logger.getInstance();

  constructor(deps: OutboxControllerDeps) {
    const { service, scheduler, credentials } = deps;

    const errorOf = <T extends OutboxCause>(cause: T) => ({
      success: false as const,
      cause,
      code: OUTBOX_ERROR_CODE[cause],
    });

    const wrap = async <T>(
      label: string,
      fn: () => Promise<T>,
    ): Promise<T | { success: false; cause: OutboxCause; code: number }> => {
      try {
        return await fn();
      } catch (e) {
        Logger.getInstance().error('[Outbox:Controller] 핸들러 예외', e, {
          unmasked: { label },
        });
        return errorOf('INTERNAL_ERROR');
      }
    };

    const handlers = {
      [ENDPOINTS.ENQUEUE]: async (req, res) =>
        res.ok(200, await wrap('ENQUEUE', () => service.enqueue(req))),
      [ENDPOINTS.DRAIN]: async (_req, res) =>
        res.ok(
          200,
          await wrap('DRAIN', async () => {
            const awakened = await scheduler.drainNow();
            return { success: true as const, data: { awakened } };
          }),
        ),
      [ENDPOINTS.GET_CHAIN]: async (req, res) =>
        res.ok(200, await wrap('GET_CHAIN', () => service.getChain(req))),
      [ENDPOINTS.RETRY]: async (req, res) =>
        res.ok(200, await wrap('RETRY', () => service.retry(req))),
      [ENDPOINTS.RESOLVE]: async (req, res) =>
        res.ok(200, await wrap('RESOLVE', () => service.resolve(req))),
      [ENDPOINTS.CANCEL]: async (req, res) =>
        res.ok(200, await wrap('CANCEL', () => service.cancel(req))),
      [ENDPOINTS.SUPERSEDE]: async (req, res) =>
        res.ok(200, await wrap('SUPERSEDE', () => service.supersede(req))),
      [ENDPOINTS.SET_CREDENTIALS]: async (req, res) =>
        res.ok(
          200,
          await wrap('SET_CREDENTIALS', async () => {
            credentials.set(req);
            // 토큰이 없어서 보류돼 있던 행들이 있다 — 새 자격으로 바로 한 번 돈다.
            await scheduler.drainNow();
            return { success: true as const };
          }),
        ),
    } satisfies ControllerHandlers<EndpointsMap>;

    super(handlers);
    this.logger.info('[Outbox:Controller] initialized');
  }
}
