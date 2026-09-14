import {
  formatLogTime,
  type LogLevel,
  type LogRecord,
  type SerialportProcess,
} from 'kiosk-types';
import { LogService } from 'src/service/LogService';

/**
 * 서브프로세스 부팅 로그 미러.
 *
 * 자식이 fork 직후(import·네이티브 로드 단계)에 죽으면 자기 Logger 로는 아무것도 못 남긴다.
 * 그래서 부모가 spawn·stderr·비정상 exit 를 **그 자식 이름으로** 남겨, 자식이 스스로 남긴
 * 줄과 한 파일에서 시간순으로 이어 읽을 수 있게 한다.
 */
export function mirrorProcessLog(record: LogRecord): void {
  LogService.getInstance().ingest(record);
}

/**
 * 부모가 자식을 대신해 만드는 레코드.
 *
 * origin 이 **자식**이라는 게 요점이다 — 누가 받아 적었는지가 아니라 무엇에 대한 줄인지가
 * 파일에서 찾는 기준이기 때문이다.
 */
export function processLogRecord(
  process: SerialportProcess,
  level: LogLevel,
  message: string,
): LogRecord {
  return {
    origin: process,
    level,
    time: formatLogTime(),
    msg: `[메인/spawn] ${message}`,
  };
}
