import { BRIDGE_ENV } from 'kiosk-types';
import type { Platform } from '../types';

/**
 * 자식 프로세스용 Platform — 값은 fork 시 env 로 주입된다.
 *
 * RPC 가 아닌 이유: 이 값들은 부팅 시 확정되고 변하지 않으며, Platform 이 동기 상수라
 * 왕복을 기다릴 수 없다. 한 번 넘기면 끝나는 것을 채널에 태울 이유가 없다.
 *
 * 누락은 즉시 실패시킨다 — 경로가 비어 있으면 오디오 캐시나 서브프로세스 실행 경로가
 * 엉뚱한 곳을 가리키고, 그건 한참 뒤 이상한 증상으로 나타난다.
 */
function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Bridge Platform 값 누락: ${key} — 부모가 fork 시 주입해야 합니다.`,
    );
  }
  return value;
}

export const platform: Platform = {
  paths: {
    userData: required(BRIDGE_ENV.USER_DATA),
    baseline: required(BRIDGE_ENV.BASELINE),
  },
  appVersion: required(BRIDGE_ENV.APP_VERSION),
  isPackaged: process.env[BRIDGE_ENV.IS_PACKAGED] === 'true',
};
