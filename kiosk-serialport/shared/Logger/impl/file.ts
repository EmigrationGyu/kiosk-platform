import fs from 'fs';
import { formatLogRecord, LOCAL_DATA_DIR, type LogRecord } from 'kiosk-types';
import os from 'os';
import path from 'path';
import type { LogSink } from '../types';

/**
 * 아무도 이 프로세스의 stdout 을 읽지 않는 토폴로지용 sink — 자기 파일에 직접 쓴다.
 *
 * 프로세스마다 파일이 갈리므로 통합 로그의 이점은 없지만, 부모 없이 단독 실행할 때
 * (패키지를 손으로 띄우는 개발·진단) 로그가 사라지지 않게 하는 마지막 보루다.
 */
const LOG_DIR = path.join(os.homedir(), LOCAL_DATA_DIR, 'logs');

const formatDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

let stream: fs.WriteStream | null = null;
let currentDate: string | null = null;
let currentOrigin: string | null = null;

const ensureStream = (origin: string): fs.WriteStream => {
  const today = formatDate(new Date());
  if (currentDate === today && currentOrigin === origin && stream)
    return stream;
  stream?.end();
  currentDate = today;
  currentOrigin = origin;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  stream = fs.createWriteStream(path.join(LOG_DIR, `${today}_${origin}.log`), {
    flags: 'a',
  });
  return stream;
};

const isDev = process.env.NODE_ENV === 'development';

export const logSink: LogSink = {
  write(record: LogRecord): void {
    const line = formatLogRecord(record);
    ensureStream(record.origin).write(line);
    if (isDev) process.stdout.write(line);
  },
};
