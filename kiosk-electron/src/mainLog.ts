import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  formatLogRecord,
  formatLogTime,
  LOG_ORIGIN,
  type LogLevel,
} from 'kiosk-types/src/log';
import { LOCAL_DATA_DIR } from 'kiosk-types/src/update/components';

/**
 * 메인 프로세스 전용 로그. 메인의 콘솔은 패키징된 앱에서 아무 데도 보이지 않는다. 나머지
 * 프로세스의 로그는 전부 백엔드가 한 파일에 모으지만 **여기만 자기 파일에 남긴다** — 백엔드로
 * 가는 전송이 끊긴 상황을 진단하는 것이 존재 이유라, 그 전송에 얹으면 정작 필요할 때 아무것도
 * 남지 않는다. 줄의 모양은 통합 로그와 같은 포맷터를 쓴다.
 */
export function mainLog(level: LogLevel, message: string): void {
  try {
    const line = formatLogRecord({
      origin: LOG_ORIGIN.MAIN,
      level,
      time: formatLogTime(),
      msg: message,
    });
    const dir = path.join(homedir(), LOCAL_DATA_DIR, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, `${formatLogTime().slice(0, 10)}_electron-main.log`),
      line,
    );
  } catch {
    // 로그조차 못 남기는 상황이면 본래 하던 일이 우선이다.
  }
}
