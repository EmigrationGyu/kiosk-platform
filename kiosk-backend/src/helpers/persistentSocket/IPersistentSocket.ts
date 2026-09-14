import type { EventEmitter } from 'events';

export interface IPersistentSocket extends EventEmitter {
  readonly isConnected: boolean;
  write(data: string | Buffer): boolean;
  close(): void;
  /**
   * 'data' 이벤트 리스너가 부재한 동안 누적된 바이트를 원자적으로 꺼내온다.
   * 호출 후 내부 버퍼는 비워진다. 쌓여있던 게 없으면 null.
   *
   * 용도: 요청-응답 쌍 사이에 상대가 선제적으로 보낸 전문(예: DaouVP 의 SIGN_TIMEOUT
   * 만료 후 S001) 을 다음 요청 진입 시점에 소비하기 위함.
   */
  takePending(): Buffer | null;
  /**
   * 첫 사용 시점에 connect 를 트리거하고 결과를 await 한다.
   *  - 이미 connected 면 즉시 resolve
   *  - `lazyConnect: true` 인 인스턴스에서 첫 호출이면 doConnect 시작 + connect 이벤트 await
   *  - 다음 connect 이벤트 시 resolve / error 이벤트 시 reject
   *
   * 시간 제한 없이 순수 이벤트 기반 — 호출자가 캔슬이 필요하면 별도 mechanism 필요.
   * connect 실패 후 PersistentSocket 자체는 자동 재연결을 계속하므로, reject 받은
   * caller 가 retry 하면 다음 시도의 connect/error 와 동기화된다.
   */
  ensureConnected(): Promise<void>;
}

export interface PersistentSocketOptions {
  /** 재연결 최대 대기 시간 (ms), default: 5000 */
  maxDelay?: number;
  /** 재연결 기본 딜레이 (ms), default: 100 */
  baseDelay?: number;
  /**
   * true 면 생성 시점에 자동 connect 안 함. 단말을 안 쓸 가능성이 있는 키오스크
   * (예: KOVAN-only 키오스크의 DaouVP socket) 가 부팅 시점에 무한 재연결 로그를
   * 남기지 않도록 함. `ensureConnected()` 첫 호출이 비로소 connect 를 트리거.
   */
  lazyConnect?: boolean;
}
