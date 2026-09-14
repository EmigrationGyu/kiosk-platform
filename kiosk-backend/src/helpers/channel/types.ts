import type { EventMap } from 'kiosk-types';
import type { SocketHandler } from '../../types/Socket';

/**
 * 백엔드가 외부 클라이언트와 양방향 통신하는 채널의 추상 포트.
 *
 * 환경별 어댑터 — vite alias `@channel/Channel` 가 빌드 타깃에 따라 swap:
 * - `impl/socket.ts` (vite-node 개발 환경, Socket.IO 네임스페이스)
 * - `impl/ipc.ts` (Electron 프로덕션 환경, `ipcMain.handle` 페어)
 *
 * 두 구현체가 같은 contract 를 따른다는 사실을 컴파일러로 강제하기 위한 인터페이스.
 * `<M>` 은 향후 `on()` 이벤트 키/페이로드를 EventMap 으로 좁히기 위한 marker (현재 미사용).
 */
export interface IChannel<_M extends EventMap = EventMap> {
  readonly namespace: string;

  on<TRequest = unknown, TResponse = unknown>(
    event: string,
    callback: SocketHandler<TRequest, TResponse>,
  ): void;

  /**
   * 등록된 핸들러를 교체. 호출 경로는 `index.ts` 의 `import.meta.hot` HMR 분기뿐 —
   * 즉 vite-node 개발 빌드에서만 실제 호출되며 electron-ipc 빌드에선 호출 자체가
   * 일어나지 않는다. 그러나 contract 차원에서는 두 어댑터가 동등하게 메서드를
   * 노출해야 `Router.reload()` 의 정적 타입이 깨지지 않는다.
   */
  replaceHandlers(handlers: Map<string, SocketHandler<unknown, unknown>>): void;
}
