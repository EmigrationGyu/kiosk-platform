/**
 * TD-200 토큰 디스펜서 에러 코드.
 *
 * 장치가 보내는 코드(0x00~)와 **애플리케이션이 사전 검증에서 만드는 코드**(0xe0~)를 한 집합에
 * 둔다. 호출부 입장에서 둘은 구별할 이유가 없고 — 어느 쪽이든 "이 요청은 실패했다"이며 —
 * 두 집합으로 나누면 경계마다 합치는 코드가 생긴다.
 */
export const TOKEN_DISPENSER_ERROR_CODE = {
  // 커맨드 에러 (장치 보고)
  UNDEFINED_COMMAND: 0x00,
  PARAMETER_ERROR: 0x01,
  DATA_ERROR: 0x02,
  CANNOT_EXECUTE: 0x03,
  EXECUTION_FAILED: 0x04,

  // 애플리케이션 레벨 (사전 검증)
  DEVICE_ERROR: 0xe0,
  NOT_IMPLEMENTED: 0xe2,
  TOKEN_EMPTY: 0xe3,
  CONFIG_MISSING: 0xe4,
} as const;

export type TokenDispenserErrorCode =
  (typeof TOKEN_DISPENSER_ERROR_CODE)[keyof typeof TOKEN_DISPENSER_ERROR_CODE];

export type TokenDispenserCause = keyof typeof TOKEN_DISPENSER_ERROR_CODE;

/** 에러 코드 → 코드명. 사람이 읽는 문구가 아니라 **원인 식별자**다(i18n 은 프론트 몫). */
export const TOKEN_DISPENSER_ERROR_MESSAGE: Record<
  TokenDispenserErrorCode,
  TokenDispenserCause
> = {
  [TOKEN_DISPENSER_ERROR_CODE.UNDEFINED_COMMAND]: 'UNDEFINED_COMMAND',
  [TOKEN_DISPENSER_ERROR_CODE.PARAMETER_ERROR]: 'PARAMETER_ERROR',
  [TOKEN_DISPENSER_ERROR_CODE.DATA_ERROR]: 'DATA_ERROR',
  [TOKEN_DISPENSER_ERROR_CODE.CANNOT_EXECUTE]: 'CANNOT_EXECUTE',
  [TOKEN_DISPENSER_ERROR_CODE.EXECUTION_FAILED]: 'EXECUTION_FAILED',
  [TOKEN_DISPENSER_ERROR_CODE.DEVICE_ERROR]: 'DEVICE_ERROR',
  [TOKEN_DISPENSER_ERROR_CODE.NOT_IMPLEMENTED]: 'NOT_IMPLEMENTED',
  [TOKEN_DISPENSER_ERROR_CODE.TOKEN_EMPTY]: 'TOKEN_EMPTY',
  [TOKEN_DISPENSER_ERROR_CODE.CONFIG_MISSING]: 'CONFIG_MISSING',
};

export const isTokenDispenserErrorCode = (
  code: number,
): code is TokenDispenserErrorCode =>
  Object.values(TOKEN_DISPENSER_ERROR_CODE).includes(
    code as TokenDispenserErrorCode,
  );

/**
 * 리셋 타임아웃 **사다리** — 세 레포가 공유하는 단일 출처. 반드시 DEVICE < BACKEND < FRONTEND.
 * 리셋은 장비가 굳었을 때의 유일한 복구 수단이라, 사다리가 뒤집히면 정확히 가장 필요한 순간에만
 * 못 쓰는 명령이 된다.
 *
 * 안쪽을 **벽시계**로 재는 이유: "폴 N회 × 간격"은 명목값이고 한 폴의 실제 비용은
 * `간격 + getStatus 왕복`이라, 폴 횟수로 잡으면 위층 타임아웃과 단위가 달라 사다리가 뒤집힌다.
 */
export const RESET_TIMEOUTS = {
  /** serialport 폴링의 벽시계 예산. */
  DEVICE_BUDGET_MS: 13_000,
  /**
   * 리셋 완료 후 **다음 명령을 못 넣는** 최소 체류. 상태 비트가 개는 것과 기구가 리셋을 마치는
   * 것은 다른 사건이다 — 플래그를 전부 내린 채로도 롤러를 정리하는 중이라, 그 창에 방출 명령이
   * 들어가면 반쯤 실행된 상태가 된다. 상태 조회로는 이 창이 안 보여 시간으로 막는다.
   */
  POST_RESET_DWELL_MS: 1_500,
  /** backend → serialport IPC 왕복 상한. 안쪽 = DEVICE_BUDGET + DWELL = 14.5s. */
  BACKEND_MS: 20_000,
  /** frontend → backend 왕복 상한. */
  FRONTEND_MS: 25_000,
} as const;
