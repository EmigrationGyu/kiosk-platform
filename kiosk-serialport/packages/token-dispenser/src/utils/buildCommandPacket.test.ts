import { describe, expect, test } from 'bun:test';
import { CONTROL_CHAR } from '../constants/protocol';
import { buildEnqPacket, buildEotPacket } from './buildCommandPacket';

/**
 * 제어문자 패킷의 와이어 포맷 박제.
 *
 * EOT 는 프로토콜상 유일한 취소 수단인데(Command list 2 에 FC8 을 되돌리는 명령이 없다)
 * 문서가 "cancel command, value = 0x04" 한 줄만 주고 절차도에 위치를 안 그린다.
 * 주소 규약은 같은 제어문자 계열인 ENQ 에서 가져왔으므로, 둘이 어긋나지 않도록 함께 고정한다.
 */
describe('제어문자 패킷', () => {
  test('ENQ = 0x05 + ADDH + ADDL', () => {
    expect([...buildEnqPacket()]).toEqual([CONTROL_CHAR.ENQ, 0x30, 0x30]);
  });

  test('EOT = 0x04 + ADDH + ADDL — ENQ 와 동일한 주소 규약', () => {
    expect([...buildEotPacket()]).toEqual([CONTROL_CHAR.EOT, 0x30, 0x30]);
  });

  test('두 제어문자는 주소 바이트를 공유하고 첫 바이트만 다르다', () => {
    const enq = buildEnqPacket();
    const eot = buildEotPacket();
    expect(enq.length).toBe(eot.length);
    expect([...enq.subarray(1)]).toEqual([...eot.subarray(1)]);
    expect(enq[0]).not.toBe(eot[0]);
  });

  test('장비 주소를 지정하면 그대로 실린다 (멀티드롭 16대 대응)', () => {
    expect([...buildEotPacket([0x31, 0x32])]).toEqual([
      CONTROL_CHAR.EOT,
      0x31,
      0x32,
    ]);
  });
});
