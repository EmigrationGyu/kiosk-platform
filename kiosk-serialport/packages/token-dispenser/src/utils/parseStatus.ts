import type { DispenserStatus } from 'kiosk-types';
import { STATUS_FLAG } from '../constants/protocol';

export type { DispenserStatus } from 'kiosk-types';

/**
 * 상태 바이트 1개 = 니블 1개를 `0x30 + nibble` 로 실어 보낸다(TD-200 프로토콜 "AP"/"RF" 응답).
 * 따라서 유효 범위는 '0'(0x30) ~ '?'(0x3f) 이며, 한 니블에 플래그가 겹치면
 * 0x3a~0x3f(`: ; < = > ?`)가 나온다 — 예: returnBoxFull|commandNotExecutable = 0xc = '<'.
 * ASCII hex('C'=0x43)가 아니라는 점이 중요하다.
 */
const NIBBLE_BASE = 0x30;
const NIBBLE_MAX = 0x3f;

/**
 * 4바이트 상태 버퍼를 파싱하여 DispenserStatus 객체로 반환
 * @param statusBytes - "SF" 이후의 4바이트 상태 버퍼
 */
export const parseStatus = (statusBytes: Buffer): DispenserStatus => {
  if (statusBytes.length !== 4) {
    throw new Error(`Expected 4 status bytes, got ${statusBytes.length}`);
  }

  let statusValue = 0;
  for (const byte of statusBytes) {
    if (byte < NIBBLE_BASE || byte > NIBBLE_MAX) {
      throw new Error(`Invalid status bytes: ${statusBytes.toString('hex')}`);
    }
    statusValue = (statusValue << 4) | (byte - NIBBLE_BASE);
  }

  return {
    returnBoxFull: (statusValue & STATUS_FLAG.RETURN_BOX_FULL) !== 0,
    commandNotExecutable:
      (statusValue & STATUS_FLAG.COMMAND_NOT_EXECUTABLE) !== 0,
    hopperPreFull: (statusValue & STATUS_FLAG.HOPPER_PRE_FULL) !== 0,
    dispensing: (statusValue & STATUS_FLAG.DISPENSING) !== 0,
    collecting: (statusValue & STATUS_FLAG.COLLECTING) !== 0,
    dispenseError: (statusValue & STATUS_FLAG.DISPENSE_ERROR) !== 0,
    returnError: (statusValue & STATUS_FLAG.RETURN_ERROR) !== 0,
    hopperFull: (statusValue & STATUS_FLAG.HOPPER_FULL) !== 0,
    tokenOverlap: (statusValue & STATUS_FLAG.TOKEN_OVERLAP) !== 0,
    tokenJam: (statusValue & STATUS_FLAG.TOKEN_JAM) !== 0,
    tokenPreEmpty: (statusValue & STATUS_FLAG.TOKEN_PRE_EMPTY) !== 0,
    tokenEmpty: (statusValue & STATUS_FLAG.TOKEN_EMPTY) !== 0,
    tokenAtGate: (statusValue & STATUS_FLAG.TOKEN_AT_GATE) !== 0,
    tokenAtMid: (statusValue & STATUS_FLAG.TOKEN_AT_MID) !== 0,
    tokenAtHopper: (statusValue & STATUS_FLAG.TOKEN_AT_HOPPER) !== 0,
  };
};
