import { CONTROL_CHAR } from '../constants/protocol';
import { generateBCC } from './extractData';

const DEFAULT_ADDR: [number, number] = [0x30, 0x30];

/**
 * TD-200 프로토콜 커맨드 패킷을 빌드한다.
 * 패킷 구조: STX + ADDR(2) + SELEN(2) + commandData + ETX + BCC
 *
 * @param commandData - CM+PM+SE_DATAB 또는 Command List 2 문자열에 해당하는 바이트
 * @param addr - 장비 주소 [ADDH, ADDL] (기본값: [0x30, 0x30])
 */
export const buildCommandPacket = (
  commandData: Buffer,
  addr: [number, number] = DEFAULT_ADDR,
): Buffer => {
  const selenH = (commandData.length >> 8) & 0xff;
  const selenL = commandData.length & 0xff;

  const packetWithoutBcc = Buffer.from([
    CONTROL_CHAR.STX,
    addr[0],
    addr[1],
    selenH,
    selenL,
    ...commandData,
    CONTROL_CHAR.ETX,
  ]);

  const bcc = generateBCC(packetWithoutBcc);
  return Buffer.concat([packetWithoutBcc, Buffer.from([bcc])]);
};

/**
 * ENQ 요청 패킷을 빌드한다.
 * 패킷 구조: ENQ + ADDH + ADDL
 */
export const buildEnqPacket = (
  addr: [number, number] = DEFAULT_ADDR,
): Buffer => {
  return Buffer.from([CONTROL_CHAR.ENQ, addr[0], addr[1]]);
};

/**
 * EOT(취소) 패킷을 빌드한다.
 * 패킷 구조: EOT + ADDH + ADDL — ENQ 와 동일한 제어문자 계열이라 주소 규약도 같다.
 *
 * 프로토콜 문서(§Note[6])는 EOT 를 "cancel command, value = 0x04" 한 줄로만 정의하고
 * 절차도에 위치를 그리지 않는다. 즉 **이미 실행 중인** 명령(FC8 토큰 투입 대기)까지
 * 끊는지는 문서로 확정할 수 없다 — 실기기 관측이 정본이다.
 */
export const buildEotPacket = (
  addr: [number, number] = DEFAULT_ADDR,
): Buffer => {
  return Buffer.from([CONTROL_CHAR.EOT, addr[0], addr[1]]);
};
