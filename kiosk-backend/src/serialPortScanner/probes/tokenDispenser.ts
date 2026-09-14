import { DEVICE_IDS } from 'src/constant/events/Hardware';
import { LogService } from 'src/service/LogService';
import { TOKEN_DISPENSER_SERIAL_EVENTS } from '../../hardwareTransport/events/TokenDispenser';
import { TokenDispenser } from '../../hardwareTransport/TokenDispenser';
import type { DeviceProbe } from '../types';

/**
 * 상태 조회(`S4`) 한 발. 이 장치를 다른 시리얼 장치와 가르는 최소 왕복이다 —
 * 응답 프레임의 ACK + 시퀀스 2바이트만 보면 되고, 장치 상태가 무엇이든(잼·소진)
 * 프레임은 돌아온다. **"멀쩡한가"가 아니라 "이 포트에 이 장치가 있는가"** 를 묻는 것이라
 * 상태 플래그를 판정에 쓰지 않는다.
 */
const STATUS_PROBE = Buffer.from([
  0x02, 0x30, 0x30, 0x00, 0x02, 0x53, 0x34, 0x03, 0x04,
]);

export const tokenDispenserProbe: DeviceProbe = {
  deviceId: DEVICE_IDS.TOKEN_DISPENSER,
  handshake: {
    request: STATUS_PROBE,
    expect: Buffer.from([0x06, 0x30, 0x30]),
    serialOptions: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
    timeout: 500,
  },
  async onDetected(result) {
    const {
      baudRate,
      dataBits = 8,
      stopBits = 1,
      parity = 'none',
    } = result.serialOptions;

    await TokenDispenser.getInstance().request(
      TOKEN_DISPENSER_SERIAL_EVENTS.PORT_ASSIGNED,
      {
        portPath: result.portPath,
        serialOptions: { baudRate, dataBits, stopBits, parity },
      },
    );

    // 소모품 경고는 방출을 막지 않아 평소엔 아무 데도 드러나지 않는다. 장치를 막 붙인
    // 지금(부팅/재탐지)이 운영자에게 알릴 유일한 지점이다.
    const status = await TokenDispenser.getInstance().request(
      TOKEN_DISPENSER_SERIAL_EVENTS.HEALTH_CHECK,
    );
    const warnings = [
      status.tokenPreEmpty && '토큰 잔량 임박',
      status.tokenEmpty && '토큰 소진',
      status.returnBoxFull && '반환함 만참',
      status.hopperPreFull && '호퍼 적재 임박',
    ].filter((w): w is string => typeof w === 'string');
    for (const warning of warnings) {
      LogService.getInstance().info('[기기점검] 토큰 디스펜서', {
        unmasked: { warning },
      });
    }
  },
  async healthCheck() {
    await TokenDispenser.getInstance().request(
      TOKEN_DISPENSER_SERIAL_EVENTS.HEALTH_CHECK,
    );
  },
  async release() {
    await TokenDispenser.getInstance().request(
      TOKEN_DISPENSER_SERIAL_EVENTS.RELEASE_PORT,
    );
  },
};
