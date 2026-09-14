import {
  LOG_EVENTS,
  type LogEventMap,
  type LogResponseBody,
} from '../constants/events/Log';
import { Log } from '../transport/Log';
import { toErrorLike } from './toErrorLike';
import type { ErrorLike } from './types';

type LogRequest = LogEventMap[typeof LOG_EVENTS.LOG]['request'];
type ErrorLogRequest = LogEventMap[typeof LOG_EVENTS.ERROR]['request'];
type Meta = NonNullable<LogRequest['meta']>;

export class Logger {
  private readonly transport: Log = new Log();

  private log(data: LogRequest): Promise<LogResponseBody> {
    return this.transport.request(LOG_EVENTS.LOG, data);
  }

  private exception(data: ErrorLogRequest): Promise<LogResponseBody> {
    return this.transport.request(LOG_EVENTS.ERROR, data);
  }

  public info(message: string): Promise<LogResponseBody>;
  public info(meta: Meta): Promise<LogResponseBody>;
  public info(message: string, meta: Meta): Promise<LogResponseBody>;
  public info(arg1: string | Meta, arg2?: Meta): Promise<LogResponseBody> {
    if (typeof arg1 === 'string') {
      return this.log(
        arg2
          ? { level: 'info', msg: arg1, meta: arg2 }
          : { level: 'info', msg: arg1 },
      );
    }
    return this.log({ level: 'info', meta: arg1 });
  }

  public error(message: string): Promise<LogResponseBody>;
  public error(err: Error | ErrorLike): Promise<LogResponseBody>;
  public error(err: unknown): Promise<LogResponseBody>;
  public error(
    message: string,
    err: Error | ErrorLike,
  ): Promise<LogResponseBody>;
  public error(message: string, err: unknown): Promise<LogResponseBody>;
  public error(arg1: unknown, arg2?: unknown): Promise<LogResponseBody> {
    if (typeof arg1 === 'string') {
      if (arg2 !== undefined) {
        return this.exception({
          level: 'error',
          msg: arg1,
          err: toErrorLike(arg2),
        });
      }
      return this.exception({ level: 'error', err: { message: arg1 } });
    }

    return this.exception({ level: 'error', err: toErrorLike(arg1) });
  }
}
