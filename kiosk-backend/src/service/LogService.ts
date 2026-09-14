import { platform } from '@platform/Platform';
import fs from 'fs';
import {
  formatLogRecord,
  formatLogTime,
  LOG_ORIGIN,
  type LogErrorArgs,
  type LogMessageArgs,
  type LogMeta,
  type LogOrigin,
  type LogRecord,
} from 'kiosk-types';
import pino from 'pino';
import type { LogEventMap } from 'src/constant/events/Log';
import {
  formatLogDate,
  getMainLogFilePath,
  KIOSK_LOG_DIR,
} from 'src/constant/LogPaths';
import { pinoLineToRecord } from './log/pinoRecord';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * 이 단말의 **유일한 로그 writer**. 백엔드·렌더러·서브프로세스·부모의 미러 로그가 전부 여기 한
 * 스트림으로 모여 한 파일에 시간순으로 쌓인다 — 프로세스마다 파일을 열던 시절엔 같은 사건의 앞뒤가
 * 파일 대여섯 개에 흩어져 사람이 손으로 합쳐야 했다.
 *
 * 레코드가 **어떻게 도착했는지는 모른다**(`ingest`) — 먹여주는 어댑터가 바뀌어도 이 클래스는 그대로다.
 */
export class LogService {
  private logDir: string = KIOSK_LOG_DIR;
  private logger: pino.Logger;
  private readonly version: string;
  private static instance: LogService | undefined;

  private currentDate?: string;
  private fileStream?: fs.WriteStream;

  private constructor() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.version = platform.appVersion;
    this.logger = this.createLogger();
  }

  static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }
    return LogService.instance;
  }

  private createLogger(): pino.Logger {
    // 동일 호출 내에서 날짜가 바뀌는(자정 경계) 극단 케이스를 피하기 위해 Date를 1번만 캡처한다.
    const now = new Date();
    this.currentDate = formatLogDate(now);
    this.fileStream?.end();
    this.fileStream = fs.createWriteStream(getMainLogFilePath(now), {
      flags: 'a',
    });

    const validLevels: pino.Level[] = [
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ];
    const envLevel = process.env.LOG_LEVEL;
    const level: pino.Level =
      envLevel && validLevels.includes(envLevel as pino.Level)
        ? (envLevel as pino.Level)
        : 'info';

    // pino 는 레벨 필터·인자 포맷팅까지만 하고, 출력은 다시 레코드로 돌려 공용 출구로 보낸다.
    // 그래야 자기 로그와 남의 레코드가 같은 스트림에 같은 순서로 쌓인다.
    return pino(
      {
        level,
        base: undefined,
        timestamp: () => `,"time":"${formatLogTime()}"`,
      },
      {
        write: (line: string) =>
          this.emit(pinoLineToRecord(line, LOG_ORIGIN.BACKEND)),
      },
    );
  }

  /** 파일에 실제로 쓰는 단 한 곳. */
  private emit(record: LogRecord): void {
    this.rotateLoggerIfNeeded();
    const line = formatLogRecord(record, { version: this.version });
    this.fileStream?.write(line);
    // 자식이 자기 파일에 쓰던 시절엔 dev 에서 자기 stdout 으로도 뱉어 콘솔에 보였다.
    // 이제 그 줄은 프레이밍돼 파일로만 가므로, 개발 중 보이던 것을 여기서 되돌린다.
    if (IS_DEV) process.stdout.write(line);
  }

  /**
   * 다른 프로세스가 만든 레코드를 그대로 받는 입구.
   *
   * 레벨 필터는 레코드를 만든 쪽이 이미 통과시킨 것이므로 여기서 다시 거르지 않는다 —
   * 거르면 자기 레벨을 따로 두는 producer(예: suprema 의 debug)가 조용히 사라진다.
   */
  public ingest(record: LogRecord): void {
    this.emit(record);
  }

  private rotateLoggerIfNeeded(): void {
    if (this.currentDate === formatLogDate(new Date()) && this.logger) return;
    this.logger = this.createLogger();
  }

  private toError(err: LogEventMap['/error']['request']['err']): Error {
    const error = new Error(err.message);
    if (err.name) error.name = err.name;
    const anyError = error as unknown as {
      code?: string | number;
      cause?: unknown;
      stack?: string;
    };
    if (err.code !== undefined) anyError.code = err.code;
    if (err.cause !== undefined) anyError.cause = err.cause as unknown;
    if (err.stack) anyError.stack = err.stack;
    return error;
  }

  private bindingsOf(
    req: LogEventMap['/log']['request'] | LogEventMap['/error']['request'],
    origin: LogOrigin,
  ): Record<string, unknown> {
    const bindings: Record<string, unknown> = { origin };
    if (req.meta) bindings.meta = req.meta;
    return bindings;
  }

  /**
   * 클라이언트의 일반 로그 요청 처리(직접 쓸 때는 `info` 를 권장). `origin` 은 이 로그를 낸
   * 프로세스 — 렌더러 요청이면 컨트롤러가 지정한다.
   */
  public writeLog(
    req: LogEventMap['/log']['request'],
    origin: LogOrigin = LOG_ORIGIN.BACKEND,
  ): void {
    const child = this.logger.child(this.bindingsOf(req, origin));
    child[req.level](req.msg);
  }

  /**
   * 클라이언트의 에러 로그 요청 처리(직접 쓸 때는 `error` 를 권장). `origin` 은 이 로그를 낸
   * 프로세스 — 렌더러 요청이면 컨트롤러가 지정한다.
   */
  public writeError(
    req: LogEventMap['/error']['request'],
    origin: LogOrigin = LOG_ORIGIN.BACKEND,
  ): void {
    const bindings = this.bindingsOf(req, origin);
    // pino는 err 키의 Error 객체를 특별 처리함
    bindings.err = this.toError(req.err);
    const child = this.logger.child(bindings);
    child[req.level](req.msg);
  }

  /**
   * 로그를 로컬 파일에 기록한다.
   *
   * **메시지는 상수여야 한다** — 값은 `meta` 로 넘긴다(조치 A-10). 백틱에 값을 끼우면
   * `LogMessageArgs` 가 컴파일을 막는다. 키는 `LOG_FIELDS` 로 닫혀 있다.
   */
  public info<M extends string>(message: M, ...args: LogMessageArgs<M>): void {
    const [meta] = args as [LogMeta?];
    this.writeLog({ level: 'info', msg: message, meta });
  }

  /**
   * 임의의 던져진 값 → 와이어 에러 필드. 가드 없는 `writeError` 를 직접 쓰는 인프라
   * (`withErrorHandler` 등)가 페이로드를 만들 수 있도록 공개한다.
   */
  public toErrFields(e: unknown): {
    message: string;
    name?: string;
    stack?: string;
    code?: string | number;
  } {
    if (e instanceof Error) {
      return { message: e.message, name: e.name, stack: e.stack };
    }
    if (e !== null && typeof e === 'object') {
      const obj = e as Record<string, unknown>;
      if ('message' in obj) {
        return {
          message: String(obj.message),
          name: typeof obj.name === 'string' ? obj.name : undefined,
          stack: typeof obj.stack === 'string' ? obj.stack : undefined,
          code:
            typeof obj.code === 'string' || typeof obj.code === 'number'
              ? obj.code
              : undefined,
        };
      }
      try {
        return { message: JSON.stringify(e) };
      } catch {
        return { message: '[unserializable object]' };
      }
    }
    if (typeof e === 'string') return { message: e };
    if (e === null || e === undefined) return { message: 'Unknown error' };
    return { message: String(e) };
  }

  /** 에러를 로컬 파일에 기록한다. 메시지 규칙은 `info` 와 같다. */
  public error<M extends string>(message: M, ...args: LogErrorArgs<M>): void {
    const [err, meta] = args as [unknown?, LogMeta?];
    if (err === undefined) {
      this.writeLog({ level: 'error', msg: message, meta });
      return;
    }
    this.writeError({
      level: 'error',
      msg: message,
      err: this.toErrFields(err),
      meta,
    });
  }

  /** 메시지 없이 에러만 있을 때 — 원인 문자열이 곧 메시지가 된다. */
  public errorOf(error: unknown, meta?: LogMeta): void {
    const fields = this.toErrFields(error);
    this.writeError({ level: 'error', msg: fields.message, err: fields, meta });
  }
}
