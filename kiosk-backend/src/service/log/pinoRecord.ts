import {
  formatLogTime,
  type LogLevel,
  type LogOrigin,
  type LogRecord,
} from 'kiosk-types';

const LEVEL_BY_NUMBER: Record<number, LogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/**
 * pino 가 뱉은 NDJSON 한 줄 → LogRecord.
 *
 * pino 는 레벨 필터·인자 포맷팅에만 쓰고, 파일에 나가는 모양은 공용 포맷터 하나로 모은다.
 * 이 변환이 있어야 백엔드가 자기 로그와 남의 레코드를 **같은 출구**로 내보낼 수 있다.
 */
export const pinoLineToRecord = (
  line: string,
  fallbackOrigin: LogOrigin,
): LogRecord => {
  const obj = JSON.parse(line) as Record<string, unknown>;
  const err = obj.err as LogRecord['err'] | undefined;
  return {
    origin: (obj.origin as LogOrigin | undefined) ?? fallbackOrigin,
    level: LEVEL_BY_NUMBER[obj.level as number] ?? 'info',
    time: (obj.time as string | undefined) ?? formatLogTime(),
    msg: obj.msg as string | undefined,
    meta: obj.meta as LogRecord['meta'],
    err,
  };
};
