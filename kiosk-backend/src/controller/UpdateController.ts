import { UPDATE_EVENTS, type UpdateEventMap } from '../constant/events/Update';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { UpdateService } from '../service/UpdateService';
import { withErrorHandler } from '../utils/errorHandler';
import { BaseController, type ControllerHandlers } from './BaseController';

export class UpdateController extends BaseController<UpdateEventMap> {
  private updateService: UpdateService = new UpdateService();

  constructor() {
    const handlers = {
      [UPDATE_EVENTS.CONTRACT_MISMATCH]: withErrorHandler(async (req, res) => {
        await this.updateService.contractMismatch(req);
        return res.ok(SUCCESS_CODE.OK, undefined);
      }, '계약 불일치 보고 처리 실패'),
      [UPDATE_EVENTS.BOOT_COMPLETED]: withErrorHandler(async (req, res) => {
        await this.updateService.bootCompleted(req);
        return res.ok(SUCCESS_CODE.OK, undefined);
      }, '부팅 완주 처리 실패'),
      [UPDATE_EVENTS.RENDERER_ALIVE]: withErrorHandler(async (_req, res) => {
        await this.updateService.rendererAlive();
        return res.ok(SUCCESS_CODE.OK, undefined);
      }, '생존 선언 처리 실패'),
      [UPDATE_EVENTS.APPLY]: withErrorHandler(async (req, res) => {
        // 적용이 이 백엔드를 교체하면 이 응답은 갈 곳이 없다 — 정상이다.
        await this.updateService.apply(req);
        return res.ok(SUCCESS_CODE.OK, undefined);
      }, '적용 지시 처리 실패'),
      [UPDATE_EVENTS.ROLLBACK]: withErrorHandler(async (req, res) => {
        await this.updateService.rollback(req);
        return res.ok(SUCCESS_CODE.OK, undefined);
      }, '롤백 지시 처리 실패'),
      [UPDATE_EVENTS.SOFTWARE_STATE]: withErrorHandler(async (_req, res) => {
        return res.ok(
          SUCCESS_CODE.OK,
          await this.updateService.softwareState(),
        );
      }, '소프트웨어 상태 조회 실패'),
      [UPDATE_EVENTS.REPORTED]: withErrorHandler(async (req, res) => {
        await this.updateService.reported(req);
        return res.ok(SUCCESS_CODE.OK, undefined);
      }, '보고 표시 실패'),
    } satisfies ControllerHandlers<UpdateEventMap>;

    super(handlers);
  }
}
