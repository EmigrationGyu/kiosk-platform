import { LOG_ORIGIN } from 'kiosk-types';
import { LOG_EVENTS, type LogEventMap } from 'src/constant/events/Log';
import { SUCCESS_CODE } from 'src/constant/SuccessCodes';
import { LogService } from 'src/service/LogService';
import { withErrorHandler } from '../utils/errorHandler';
import { BaseController, type ControllerHandlers } from './BaseController';

/**
 * 렌더러가 보내온 로그의 어댑터.
 *
 * 로그 파일이 하나로 합쳐지면서 출처는 파일명이 아니라 레코드의 origin 이 진다. 렌더러는
 * 자기 이름을 실어 보내지 않으므로, 그 경계를 아는 **여기서** 찍는다.
 */
export class LogController extends BaseController<LogEventMap> {
  private logService: LogService = LogService.getInstance();

  constructor() {
    const handlers = {
      [LOG_EVENTS.LOG]: withErrorHandler((req, res) => {
        this.logService.writeLog(req, LOG_ORIGIN.RENDERER);
        return res.ok(SUCCESS_CODE.OK, { success: true });
      }, 'Failed to log message'),

      [LOG_EVENTS.ERROR]: withErrorHandler((req, res) => {
        this.logService.writeError(req, LOG_ORIGIN.RENDERER);
        return res.ok(SUCCESS_CODE.OK, { success: true });
      }, 'Failed to log error'),
    } satisfies ControllerHandlers<LogEventMap>;

    super(handlers);
  }
}
