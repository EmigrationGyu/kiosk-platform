import type {
  CancelRequest,
  EnqueueRequest,
  GetChainRequest,
  ResolveRequest,
  RetryRequest,
  SupersedeRequest,
} from 'kiosk-types';
import { OUTBOX_EVENTS } from 'src/hardwareTransport/events/Outbox';
import { Outbox } from 'src/hardwareTransport/Outbox';

/**
 * 렌더러 ↔ outbox 서브프로세스 릴레이.
 *
 * **여기에 도메인 로직을 두지 않는다.** 양쪽이 같은 이벤트·같은 스키마를 쓰므로 이 서비스는
 * 봉투를 옮기기만 한다 — 판단(멱등·기한·재시도)은 전부 서브프로세스 안에 있고, 백엔드가
 * 그 일부를 흉내내기 시작하면 진실 공급원이 둘이 된다.
 *
 * 자격 주입(SET_CREDENTIALS)은 이 표면에 없다. 토큰은 백엔드가 직접 넘긴다.
 */
export class OutboxService {
  private outbox: Outbox = Outbox.getInstance();

  enqueue(req: EnqueueRequest) {
    return this.outbox.request(OUTBOX_EVENTS.ENQUEUE, req);
  }

  drain() {
    return this.outbox.request(OUTBOX_EVENTS.DRAIN);
  }

  getChain(req: GetChainRequest) {
    return this.outbox.request(OUTBOX_EVENTS.GET_CHAIN, req);
  }

  retry(req: RetryRequest) {
    return this.outbox.request(OUTBOX_EVENTS.RETRY, req);
  }

  resolve(req: ResolveRequest) {
    return this.outbox.request(OUTBOX_EVENTS.RESOLVE, req);
  }

  cancel(req: CancelRequest) {
    return this.outbox.request(OUTBOX_EVENTS.CANCEL, req);
  }

  supersede(req: SupersedeRequest) {
    return this.outbox.request(OUTBOX_EVENTS.SUPERSEDE, req);
  }
}
