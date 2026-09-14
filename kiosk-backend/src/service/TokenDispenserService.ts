import type { DispenserStatus } from 'kiosk-types';
import { DEVICE_IDS } from 'src/constant/events/Hardware';
import { EnsureDevice } from 'src/serialPortScanner/EnsureDevice';
import { TOKEN_DISPENSER_SERIAL_EVENTS } from '../hardwareTransport/events/TokenDispenser';
import { TokenDispenser } from '../hardwareTransport/TokenDispenser';
import { LogService } from './LogService';

/**
 * 프론트 요청 ↔ 하드웨어 트랜스포트 사이의 글루. 장치 사정(중간 위치·급지 모드·폴링)은
 * 여기서 끝나고 위로 올라가지 않는다.
 *
 * `@EnsureDevice` 는 메서드 본문 전에 생존을 보장한다(헬스체크 → 실패 시 재탐지).
 * **데코레이터가 없는 메서드는 게이트를 일부러 건너뛴 것**이다 — 아래 `status()` 참고.
 */
export class TokenDispenserService {
  private readonly transport = TokenDispenser.getInstance();
  private readonly logger = LogService.getInstance();

  /**
   * n 개 방출. 한 장씩 내보내고 **매 장마다 손님이 가져갔는지 확인한 뒤** 다음 장을 민다.
   *
   * 게이트에 토큰이 남은 채로 다음 장을 밀면 두 장이 겹쳐 물리거나(tokenOverlap) 잼이 난다.
   * 그래서 회수 확인이 선택이 아니라 **다음 방출의 전제**다 — 확인을 건너뛰는 경로를 두면
   * 그 경로만 조용히 겹쳐 물린다.
   *
   * 중간에 실패하면 **거기서 멈추고 그때까지 나간 수를 그대로 보고한다.** 총 n 개를 맞추려
   * 재시도하지 않는다: 이미 나간 토큰은 손님 손에 있을 수 있어, 재시도는 과방출이 된다.
   */
  @EnsureDevice(DEVICE_IDS.TOKEN_DISPENSER)
  async dispense(
    count: number,
  ): Promise<{ dispensed: number; status: DispenserStatus }> {
    let dispensed = 0;
    let status = await this.transport.request(
      TOKEN_DISPENSER_SERIAL_EVENTS.HEALTH_CHECK,
    );

    for (let i = 0; i < count; i++) {
      if (status.tokenAtGate) {
        this.logger.writeLog({
          level: 'warn',
          msg: '[토큰] 이전 토큰 미회수 — 남은 방출을 중단한다',
          // 레지스트리에 없는 키는 포맷 단계에서 값이 버려진다([미등록]) — 경고가 왜
          // 났는지 설명하는 숫자가 바로 그 둘이라, 진단값 자리인 unmasked 로 보낸다.
          meta: { unmasked: { requested: count, dispensed } },
        });
        break;
      }
      if (status.tokenEmpty) {
        this.logger.writeLog({
          level: 'warn',
          msg: '[토큰] 소진 — 남은 방출을 중단한다',
          // 레지스트리에 없는 키는 포맷 단계에서 값이 버려진다([미등록]) — 경고가 왜
          // 났는지 설명하는 숫자가 바로 그 둘이라, 진단값 자리인 unmasked 로 보낸다.
          meta: { unmasked: { requested: count, dispensed } },
        });
        break;
      }
      status = await this.transport.request(
        TOKEN_DISPENSER_SERIAL_EVENTS.DISPENSE,
      );
      dispensed += 1;
    }

    return { dispensed, status };
  }

  /** 게이트에 남은 토큰을 반환함으로. 손님이 안 가져간 경우의 처분. */
  @EnsureDevice(DEVICE_IDS.TOKEN_DISPENSER)
  async returnToken(): Promise<DispenserStatus> {
    return this.transport.request(TOKEN_DISPENSER_SERIAL_EVENTS.RETURN_TOKEN);
  }

  /**
   * 상태 조회. **게이트를 일부러 안 건다** — 이 메서드는 "장치가 살아있나"를 묻는 쪽이
   * 쓰는데, 게이트가 앞에서 재탐지를 돌리면 답을 얻기 전에 그 판정이 먼저 나버린다.
   */
  async status(): Promise<DispenserStatus> {
    return this.transport.request(TOKEN_DISPENSER_SERIAL_EVENTS.HEALTH_CHECK);
  }

  @EnsureDevice(DEVICE_IDS.TOKEN_DISPENSER)
  async reset(): Promise<DispenserStatus> {
    return this.transport.request(TOKEN_DISPENSER_SERIAL_EVENTS.RESET);
  }
}
