import type { BridgeMethod } from 'kiosk-types';

/**
 * 자식 프로세스가 부모(electron 메인)와 말하는 최소 채널.
 *
 * `MessagePortMain`·`parentPort` 같은 electron 타입에 직접 의존하지 않는다 — 그래야
 * 브리지 impl 들이 electron 을 import 하지 않고(=`forbid-electron` 게이트 통과),
 * 테스트가 가짜를 끼워넣을 수 있다. 실제 연결은 bootstrap 이 주입한다.
 */
export type MessageLike = {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on(event: 'message', listener: (value: MessageEventLike) => void): void;
  start?(): void;
};

/** 전달된 포트가 함께 오는 메시지 이벤트. */
export type MessageEventLike = {
  data: unknown;
  ports?: readonly MessageLike[];
};

export type BridgeClient = {
  /**
   * 부모의 능력을 빌려 쓴다. 거부/실패는 reject 된다.
   * `port` 는 결과에 포트가 실려 오는 호출(spawn)에서만 채워진다.
   */
  call(
    method: BridgeMethod,
    ...args: unknown[]
  ): Promise<{ value: unknown; port: MessageLike | null }>;
  /**
   * 부모가 넘겨주는 렌더러 포트를 구독한다. 백엔드가 재기동되거나 메인이 재배선하면
   * **다시 호출된다** — 구독자는 포트가 갈릴 수 있다고 가정해야 한다.
   */
  onRendererPort(listener: (port: MessageLike) => void): void;
  /** 부모가 보내는 자식 프로세스 생명주기 통지. */
  onProcessEvent(
    listener: (event: {
      process: string;
      event: 'exit' | 'stdout' | 'stderr';
      code?: number | null;
      text?: string;
    }) => void,
  ): () => void;
};
