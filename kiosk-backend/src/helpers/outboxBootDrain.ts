import { OUTBOX_EVENTS } from 'src/hardwareTransport/events/Outbox';
import { Outbox } from 'src/hardwareTransport/Outbox';
import { LogService } from 'src/service/LogService';
import {
  pushOutboxCredentials,
  startOutboxCredentialSync,
} from './outboxCredentials';

/**
 * 부팅 시 outbox 접촉 — 자격을 먼저 넘기고 그 다음에 깨운다.
 *
 * 순서가 뒤집히면 첫 사이클이 자격 없이 돌아 전부 deferred 로 되돌아온다. 해롭진 않지만
 * 30초를 그냥 버린다.
 *
 * 자격이 없어도(로그인 전) 드레인은 한다 — 그게 승격 검증의 접촉 경로이기 때문이다.
 */
export function bootstrapOutbox(): void {
  // 먼저 등록한다 — 이 뒤의 어떤 (재)기동도 자격을 다시 받는다.
  startOutboxCredentialSync();

  void pushOutboxCredentials()
    .catch((e) => {
      LogService.getInstance().error('[Outbox] 자격 전달 실패:', e);
    })
    .finally(drainOutboxOnBoot);
}

/**
 * 부팅 직후 outbox 에 한 번 말을 건다. 한 호출이 두 일을 한다.
 *
 * 1. **밀린 큐를 깨운다.** 어제 못 나간 것이 다음 enqueue 를 기다릴 이유가 없다.
 * 2. **승격 검증에 outbox 를 편입시킨다.** 계약 판정은 등록 목록이 아니라 관측을 보므로,
 *    부팅 중 아무도 접촉하지 않는 프로세스는 지문이 대조되지 않은 채 승격된다(kovan 이
 *    그 자리다). outbox 는 kovan 과 달리 조건부 설치가 아니라 항상 쓰이므로, 어긋난
 *    지문이 실제 체크인 도중에야 드러나면 늦다.
 *
 * 부팅을 막지 않는다 — 큐가 안 깨어난 것은 다음 타이머 사이클이 만회하고, 응답이 없었다는
 * 사실 자체는 승격 판정이 알아서 든다(그게 이 호출의 목적이다).
 */
export function drainOutboxOnBoot(): void {
  const logger = LogService.getInstance();

  Outbox.getInstance()
    .request(OUTBOX_EVENTS.DRAIN)
    .then((result) => {
      if (result.success) {
        logger.info('[Outbox] 부팅 드레인 — 픽업', {
          unmasked: { awakened: result.data.awakened },
        });
        return;
      }
      // 봉투는 왔으나 내용이 실패 — 승격 판정에는 문제없고, 큐가 안 깨어난 것만 남는다.
      logger.error(`[Outbox] 부팅 드레인 거절: ${result.cause}`);
    })
    .catch((e) => {
      logger.error('[Outbox] 부팅 드레인 실패:', e);
    });
}
