import { encodeLogLine, type LogRecord } from 'kiosk-types';
import type { LogSink } from '../types';

/**
 * 부모가 이 프로세스의 stdout 을 읽는 토폴로지용 sink — 지금의 node·bridge 둘 다 해당한다.
 *
 * 파일을 열지 않는다. 로그 파일을 소유한 프로세스(백엔드)가 **유일한 writer** 여야 줄이
 * 섞이지 않고, 그러려면 자식은 파일이 아니라 부모에게 말해야 한다.
 *
 * 프레이밍(접두어)은 codec 안에 있다 — 같은 stdout 으로 나가는 `[ready]` 같은 신호와
 * 구분되어야 부모가 로그만 골라낼 수 있다.
 */
export const logSink: LogSink = {
  write(record: LogRecord): void {
    process.stdout.write(`${encodeLogLine(record)}\n`);
  },
};
