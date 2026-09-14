import type { EventMap } from '../types';
import { type MessagePortLike, MessageRouter } from './messageRouter';

/**
 * 프로덕션용 Router: Node 표준 IPC(`child_process.fork`) 통신.
 *
 * **`electron.ts` 의 형제다** — 봉투 규약도 핸들러 디스패치도 같은 코어를 쓰고, 다른 것은 채널을 어디서
 * 얻는지와 언랩 여부뿐이다(개발용 네임드 파이프와는 무관하다).
 *
 * 이 자식은 **자기 런타임을 들고 온다** — 네이티브 의존이 호스트와 다른 아키텍처로만 배포되는 경우
 * (32비트 벤더 DLL)라 electron utilityProcess 에 얹히지 못해, 부모가 `fork` 로 띄운다.
 */
export class Router<M extends EventMap> extends MessageRouter<M> {
  protected connect(): MessagePortLike {
    const send = process.send?.bind(process);
    if (!send) {
      throw new Error(
        'IPC 채널이 없습니다. 이 모듈은 child_process.fork 로 떠야 합니다.',
      );
    }

    /**
     * 부모가 사라지면 같이 내려간다. utilityProcess 자식은 부모가 죽을 때 OS 가 함께 정리하지만
     * `child_process` 자식은 **살아남는다** — 남으면 그 고아가 장치 COM 포트를 계속 물어 다음 기동이
     * 실패한다.
     */
    process.on('disconnect', () => process.exit(0));

    return {
      postMessage: (message) => {
        send(message);
      },
      // node IPC 는 메시지를 그대로 준다 — 언랩할 껍데기가 없다.
      onMessage: (listener) => {
        process.on('message', listener);
      },
    };
  }
}
