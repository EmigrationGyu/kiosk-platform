import { SERIALPORT_PROCESS } from 'kiosk-types';
import { SerialPortScannerBootstrap } from 'src/serialPortScanner/SerialPortScannerBootstrap';
import { withErrorHandler } from 'src/utils/errorHandler';
import {
  DEVICE_IDS,
  type DeviceId,
  HARDWARE_EVENTS,
  type HardwareEventMap,
  type WarmableProcess,
  type WarmupResult,
} from '../constant/events/Hardware';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { IME_EVENTS } from '../hardwareTransport/events/Ime';
import { Ime } from '../hardwareTransport/Ime';
// @gen:warmup-import
import { BaseController, type ControllerHandlers } from './BaseController';

// 스캐너 관할 디바이스의 워밍 = ensureDevice 풀 체인
// (lazy spawn → 헬스체크 → 실패 시 재스캔 → PORT_ASSIGNED → 디바이스 init).
const scannerWarm = (deviceId: DeviceId) => () =>
  SerialPortScannerBootstrap.getInstance().ensureDevice(deviceId);

// 서브프로세스별 워밍 전략 — WARMABLE_PROCESSES(닫힌 집합)와 satisfies 로 짝을 맞춘다.
// 스캐너 밖 디바이스(포트 스캔이 없는 suprema/ime)는 가장 싼 왕복 한 번이면 충분하다:
// 첫 request 가 lazy spawn 을 트리거하고, 응답이 왔다는 것이 곧 부팅(SDK/엔진 로드) 완료다.
const WARMUP_STRATEGIES = {
  [SERIALPORT_PROCESS.TOKEN_DISPENSER]: scannerWarm(DEVICE_IDS.TOKEN_DISPENSER),
  [SERIALPORT_PROCESS.IME]: () =>
    Ime.getInstance().request(IME_EVENTS.HEALTH_CHECK),
  // @gen:warmup-strategy
} satisfies Record<WarmableProcess, () => Promise<unknown>>;

export class HardwareController extends BaseController<HardwareEventMap> {
  private serialPortScannerBootstrap = SerialPortScannerBootstrap.getInstance();

  constructor() {
    const handlers = {
      [HARDWARE_EVENTS.SCAN]: withErrorHandler(async (req, res) => {
        const result = await this.serialPortScannerBootstrap.scanAndWait(req);
        return res.ok(SUCCESS_CODE.OK, result);
      }, 'Failed to scan'),
      [HARDWARE_EVENTS.WARMUP]: withErrorHandler(async (req, res) => {
        const settled = await Promise.allSettled(
          req.map((process) => WARMUP_STRATEGIES[process]()),
        );
        const result: WarmupResult = Object.fromEntries(
          req.map((process, i) => [
            process,
            settled[i]?.status === 'fulfilled',
          ]),
        );
        return res.ok(SUCCESS_CODE.OK, result);
      }, 'Failed to warm up'),
    } satisfies ControllerHandlers<HardwareEventMap>;

    super(handlers);
  }
}
