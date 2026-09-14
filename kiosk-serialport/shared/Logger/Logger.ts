import { logSink } from '@log/Sink';
import {
  formatLogTime,
  type LogErrorArgs,
  type LogLevel,
  type LogMessageArgs,
  type LogMeta,
  type LogOrigin,
  type LogRecord,
} from 'kiosk-types';

/**
 * 서브프로세스의 로거 — **레코드를 만들 뿐 어디에 쓰이는지는 모른다.**
 *
 * 경로 계산·파일 쓰기·사람이 읽는 포맷은 전부 밖으로 나갔다. 그 셋이 여기 있으면 "내 로그는 내 파일에
 * 떨어진다"는 토폴로지 가정이 로거 안에 박혀, 파일을 합치거나 백엔드를 옮길 때마다 로거를 고쳐야 한다.
 * 어디로 나가는지는 `@log/Sink` 어댑터가 정한다.
 */
export class Logger {
  private readonly origin: LogOrigin;
  private static instance: Logger | undefined;

  private constructor(origin: LogOrigin) {
    this.origin = origin;
  }

  /**
   * 프로세스당 하나. 최초 호출에서 origin(= 이 프로세스의 식별자)을 지정하면 이후 `getInstance()` 는
   * 같은 인스턴스를 돌려준다. 예: `Logger.getInstance(SERIALPORT_PROCESS.CARDKEY_DISPENSER)`
   */
  static getInstance(origin?: LogOrigin): Logger {
    if (!Logger.instance) {
      if (!origin) {
        throw new Error(
          'Logger.getInstance()의 최초 호출에서는 origin을 지정해야 합니다.',
        );
      }
      Logger.instance = new Logger(origin);
    }
    return Logger.instance;
  }

  private emit(
    level: LogLevel,
    msg: string,
    err?: unknown,
    meta?: LogMeta,
  ): void {
    const record: LogRecord = {
      origin: this.origin,
      level,
      // 시각은 **발생한 여기서** 찍는다 — 받는 쪽이 도착 시각으로 찍으면 파이프를 타고 간
      // 자식 로그가 자기 프로세스 안의 순서를 잃는다.
      time: formatLogTime(),
      msg,
    };
    if (err !== undefined) record.err = toErrorFields(err);
    if (meta !== undefined) record.meta = meta;
    logSink.write(record);
  }

  /**
   * **메시지는 상수여야 한다** — 값은 `meta` 로 넘긴다(조치 A-10). 백틱에 값을 끼우면
   * `LogMessageArgs` 가 컴파일을 막는다. 키는 `LOG_FIELDS` 로 닫혀 있고, 장비 진단처럼
   * 어휘가 무한한 값은 `unmasked` 로 보낸다.
   *
   * 마스킹은 여기가 아니라 `formatLogRecord` 가 한다 — sink 를 file 로 스왑해 자기 파일에
   * 직접 쓰는 토폴로지에서도 같은 규칙이 걸려야 한다.
   */
  info<M extends string>(msg: M, ...args: LogMessageArgs<M>): void {
    const [meta] = args as [LogMeta?];
    this.emit('info', msg, undefined, meta);
  }

  warn<M extends string>(msg: M, ...args: LogMessageArgs<M>): void {
    const [meta] = args as [LogMeta?];
    this.emit('warn', msg, undefined, meta);
  }

  error<M extends string>(msg: M, ...args: LogErrorArgs<M>): void {
    const [err, meta] = args as [unknown?, LogMeta?];
    this.emit('error', msg, err, meta);
  }
}

const toErrorFields = (err: unknown): LogRecord['err'] => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
};
