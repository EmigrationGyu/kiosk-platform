import {
  IME_ERROR_CODE,
  IME_EVENTS,
  type ImeEventMap,
} from '../constant/events/Ime';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { ImeAssetService } from '../service/ImeAssetService';
import { ImeService } from '../service/ImeService';
import {
  withErrorHandler,
  withHardwareErrorHandler,
} from '../utils/errorHandler';
import { BaseController, type ControllerHandlers } from './BaseController';

export class ImeController extends BaseController<ImeEventMap> {
  private imeService: ImeService = new ImeService();
  private imeAssetService: ImeAssetService = new ImeAssetService();

  constructor() {
    const handlers = {
      [IME_EVENTS.PROCESS_KEY]: withHardwareErrorHandler(
        IME_ERROR_CODE,
        async (req, res) => {
          const state = await this.imeService.processKey(req);
          return res.ok(SUCCESS_CODE.OK, { success: true, data: state });
        },
        'Failed to process ime key',
      ),
      [IME_EVENTS.SELECT_CANDIDATE]: withHardwareErrorHandler(
        IME_ERROR_CODE,
        async (req, res) => {
          const state = await this.imeService.selectCandidate(req);
          return res.ok(SUCCESS_CODE.OK, { success: true, data: state });
        },
        'Failed to select ime candidate',
      ),
      [IME_EVENTS.CLEAR]: withHardwareErrorHandler(
        IME_ERROR_CODE,
        async (_req, res) => {
          const state = await this.imeService.clear();
          return res.ok(SUCCESS_CODE.OK, { success: true, data: state });
        },
        'Failed to clear ime',
      ),
      // 하드웨어 경유가 아닌 백엔드 자체 파일시스템 작업 — 디바이스 cause 매핑이 무의미해
      // withHardwareErrorHandler 가 아니라 plain withErrorHandler 를 쓴다.
      [IME_EVENTS.ENSURE_ASSETS]: withErrorHandler(async (_req, res) => {
        const result = this.imeAssetService.ensure();
        return res.ok(SUCCESS_CODE.OK, { success: true, data: result });
      }, 'Failed to ensure ime assets'),
    } satisfies ControllerHandlers<ImeEventMap>;

    super(handlers);
  }
}
