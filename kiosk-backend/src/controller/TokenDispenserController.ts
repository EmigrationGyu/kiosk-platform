import { TOKEN_DISPENSER_ERROR_CODE } from 'kiosk-types';
import { withHardwareErrorHandler } from 'src/utils/errorHandler';
import {
  TOKEN_DISPENSER_EVENTS,
  type TokenDispenserEventMap,
} from '../constant/events/TokenDispenser';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { TokenDispenserService } from '../service/TokenDispenserService';
import { BaseController, type ControllerHandlers } from './BaseController';

/**
 * 장치 실패는 예외가 아니라 **결과값**이다 — 잼·소진은 정상적으로 일어나는 일이고,
 * 프론트는 그걸 화면으로 보여줘야 한다. `withHardwareErrorHandler` 가 알려진 원인만
 * `{ success:false, cause }` 로 흘리고 나머지는 500 으로 남긴다. 응답 타입이 실패를
 * 표현할 수 없으면(예: void) 이 HOF 는 컴파일되지 않는다.
 */
export class TokenDispenserController extends BaseController<TokenDispenserEventMap> {
  private service = new TokenDispenserService();

  constructor() {
    const handlers = {
      [TOKEN_DISPENSER_EVENTS.DISPENSE]: withHardwareErrorHandler(
        TOKEN_DISPENSER_ERROR_CODE,
        async (req, res) => {
          const result = await this.service.dispense(req.count);
          return res.ok(SUCCESS_CODE.OK, { success: true, data: result });
        },
        'Failed to dispense token',
      ),
      [TOKEN_DISPENSER_EVENTS.RETURN]: withHardwareErrorHandler(
        TOKEN_DISPENSER_ERROR_CODE,
        async (_req, res) => {
          const status = await this.service.returnToken();
          return res.ok(SUCCESS_CODE.OK, { success: true, data: status });
        },
        'Failed to return token',
      ),
      [TOKEN_DISPENSER_EVENTS.STATUS]: withHardwareErrorHandler(
        TOKEN_DISPENSER_ERROR_CODE,
        async (_req, res) => {
          const status = await this.service.status();
          return res.ok(SUCCESS_CODE.OK, { success: true, data: status });
        },
        'Failed to read token dispenser status',
      ),
      [TOKEN_DISPENSER_EVENTS.RESET]: withHardwareErrorHandler(
        TOKEN_DISPENSER_ERROR_CODE,
        async (_req, res) => {
          const status = await this.service.reset();
          return res.ok(SUCCESS_CODE.OK, { success: true, data: status });
        },
        'Failed to reset token dispenser',
      ),
    } satisfies ControllerHandlers<TokenDispenserEventMap>;

    super(handlers);
  }
}
