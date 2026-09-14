import type { EventMap } from '../types';
import { type MessagePortLike, MessageRouter } from './messageRouter';

/**
 * Electron parentPort 호환 인터페이스.
 * 직접 Electron 타입에 의존하지 않아 테스트·목킹이 용이하다.
 */
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
}

/**
 * 프로덕션용 Router: Electron utilityProcess parentPort 통신.
 *
 * 봉투 규약과 핸들러 디스패치는 전부 `MessageRouter` 코어에 있다 — 여기 있는 것은
 * "이 토폴로지에서 부모와 이어진 채널을 어디서 얻나"뿐이다.
 */
export class Router<M extends EventMap> extends MessageRouter<M> {
  protected connect(): MessagePortLike {
    const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
    if (!port) {
      throw new Error(
        'parentPort is not available. This module must run as an Electron utility process.',
      );
    }
    return {
      postMessage: (message) => port.postMessage(message),
      // parentPort 는 이벤트 객체로 감싸 준다 — 언랩은 이 자리의 몫이다.
      onMessage: (listener) => port.on('message', (e) => listener(e.data)),
    };
  }
}
