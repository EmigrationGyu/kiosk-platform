import type { DeviceId } from 'src/constant/events/Hardware';
import { SerialPortScannerBootstrap } from './SerialPortScannerBootstrap';

/**
 * 메서드 실행 전 해당 디바이스의 생존(health check → 실패 시 재탐지)을 보장하는 선언적 가드.
 * 각 서비스 메서드 본문 첫 줄에 반복되던 `await this.ensureConnection()` 보일러플레이트를 대체한다.
 *
 * ⚠️ ensureDevice가 throw하면 메서드 본문은 실행되지 않고 예외가 그대로 전파된다.
 *   - 실패를 잡아 분기하는 메서드(예: `{ connected: boolean }` 반환)에는 쓰지 말 것 —
 *     데코레이터는 본문 바깥에서 throw하므로 본문 내부 try/catch가 잡지 못한다.
 *   - 게이트를 의도적으로 건너뛰는 메서드(예: mutex 보유 중 cancel)에는 데코레이터를 생략한다 —
 *     "데코레이터 부재"가 곧 "게이트 생략" 의도를 드러낸다.
 *
 * 타입 안전: This/Args/Return을 그대로 보존하므로 데코레이트된 메서드의 시그니처는 변하지 않는다.
 */
export function EnsureDevice(deviceId: DeviceId) {
  return function <This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    _context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >,
  ) {
    return async function (this: This, ...args: Args): Promise<Return> {
      await SerialPortScannerBootstrap.getInstance().ensureDevice(deviceId);
      return target.apply(this, args);
    };
  };
}
