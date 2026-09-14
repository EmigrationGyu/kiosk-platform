import { OUTBOX_EVENTS, type OutboxEventMap } from '../constant/events/Outbox';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { OutboxService } from '../service/OutboxService';
import { withErrorHandler } from '../utils/errorHandler';
import { BaseController, type ControllerHandlers } from './BaseController';

/**
 * 렌더러가 부르는 outbox 표면. 서브프로세스로 그대로 넘긴다.
 *
 * 응답의 Result 는 **서브프로세스가 만든 것을 그대로** 돌려준다 — 여기서 다시 감싸면
 * 원인 코드가 한 겹 더 덮여 호출부가 무엇이 실패했는지 잃는다.
 */
export class OutboxController extends BaseController<OutboxEventMap> {
  private outboxService: OutboxService = new OutboxService();

  constructor() {
    const handlers = {
      [OUTBOX_EVENTS.ENQUEUE]: withErrorHandler(async (req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.enqueue(req));
      }, 'outbox enqueue 실패'),

      [OUTBOX_EVENTS.DRAIN]: withErrorHandler(async (_req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.drain());
      }, 'outbox drain 실패'),

      [OUTBOX_EVENTS.GET_CHAIN]: withErrorHandler(async (req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.getChain(req));
      }, 'outbox 체인 조회 실패'),

      [OUTBOX_EVENTS.RETRY]: withErrorHandler(async (req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.retry(req));
      }, 'outbox retry 실패'),

      [OUTBOX_EVENTS.RESOLVE]: withErrorHandler(async (req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.resolve(req));
      }, 'outbox resolve 실패'),

      [OUTBOX_EVENTS.CANCEL]: withErrorHandler(async (req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.cancel(req));
      }, 'outbox cancel 실패'),

      [OUTBOX_EVENTS.SUPERSEDE]: withErrorHandler(async (req, res) => {
        return res.ok(SUCCESS_CODE.OK, await this.outboxService.supersede(req));
      }, 'outbox supersede 실패'),
    } satisfies ControllerHandlers<OutboxEventMap>;

    super(handlers);
  }
}
