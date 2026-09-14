/**
 * TD-200 토큰 디스펜서 통신 프로토콜.
 *
 * 가상 장치다 — 실물 벤더 프로토콜을 공개할 수 없어, 같은 구조·같은 난이도의 규약을
 * 새로 정의하고 상위 계층(FSM·뮤텍스·파서)은 원본 그대로 두었다. 전문은 PROTOCOL.md.
 */

// 프레이밍 제어 문자 (ASCII 표준)
export const CONTROL_CHAR = {
  STX: 0x02,
  ETX: 0x03,
  EOT: 0x04,
  ENQ: 0x05,
  ACK: 0x06,
  NAK: 0x15,
} as const;

export const RESPONSE_CODE = {
  SUCCESS: 0x59, // 'Y'
  FAILURE: 0x45, // 'E'
} as const;

export const COMMAND = {
  /** 상태 조회 — 4바이트 상태 반환 */
  CHECK_STATUS_FULL: 'S4',
  /** 상태 조회 — 3바이트(하위 니블 생략) 반환 */
  CHECK_STATUS_SHORT: 'S3',
  /** 토큰 1장을 게이트까지 방출 */
  DISPENSE: 'T1',
  /** 게이트의 토큰을 반환함으로 */
  RETURN_TOKEN: 'T2',
  /** 게이트의 토큰을 호퍼로 되돌림(재사용) */
  COLLECT_TO_HOPPER: 'T3',
  /** 게이트 직전 대기 위치까지만 방출 */
  DISPENSE_TO_HOLD: 'P4',
  /** 중간 센서 위치까지만 방출 */
  DISPENSE_TO_MID: 'P6',
  RESET: 'Z0',
  GET_VERSION: 'V0',
  BUFFER_ENABLE: 'B1',
  BUFFER_DISABLE: 'B0',
  /** 자동 급지 모드 */
  SET_AUTO_FEEDING: 'F0',
  /** 명령 급지 모드 — 방출 명령이 있을 때만 호퍼가 돈다 */
  SET_COMMAND_FEEDING: 'F1',
  /** 상태 응답 프리픽스 */
  STATUS_RESPONSE: 'SR',
} as const;

/**
 * 상태 비트 플래그 (16비트). 니블 4개를 각각 `0x30 + nibble` 로 실어 보내므로
 * 전선 위에서는 항상 출력 가능한 ASCII 범위('0'~'?')에 머문다 — parseStatus 참고.
 */
export const STATUS_FLAG = {
  // 니블 1 (bit 15~12) — 수용 한계 / 명령 가부
  RETURN_BOX_FULL: 0x8000,
  COMMAND_NOT_EXECUTABLE: 0x4000,
  HOPPER_FULL: 0x2000,
  HOPPER_PRE_FULL: 0x1000,

  // 니블 2 (bit 11~8) — 진행/실패
  DISPENSING: 0x0800,
  COLLECTING: 0x0400,
  DISPENSE_ERROR: 0x0200,
  RETURN_ERROR: 0x0100,

  // 니블 3 (bit 7~4) — 반송로 이상 / 잔량
  TOKEN_JAM: 0x0080,
  TOKEN_OVERLAP: 0x0040,
  TOKEN_PRE_EMPTY: 0x0020,
  TOKEN_EMPTY: 0x0010,

  // 니블 4 (bit 3~0) — 경로 위 광센서 (호퍼 출구 → 중간 → 게이트). 0x0008 은 미할당.
  TOKEN_AT_HOPPER: 0x0004,
  TOKEN_AT_MID: 0x0002,
  TOKEN_AT_GATE: 0x0001,
} as const;
