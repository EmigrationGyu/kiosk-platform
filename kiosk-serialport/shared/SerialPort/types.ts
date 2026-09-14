export type SerialPortConnectionInfo = {
  portPath: string;
  serialOptions: Record<string, unknown>;
};

export interface TranslationStrategy<TReq, TRes> {
  encode(request: TReq): Buffer;
  decode(response: Buffer): TRes;
}

/**
 * 프로토콜 기반 메시지 파서 인터페이스.
 * InterByteTimeoutParser 대신 프로토콜 구조로 메시지 경계를 판단할 때 사용한다.
 */
export interface MessageParser {
  /** raw 바이트를 누적한다. */
  feed(chunk: Buffer): void;
  /** 완성된 메시지를 수신할 리스너를 등록한다. 기존 리스너는 교체된다. */
  onMessage(callback: (message: Buffer) => void): void;
  /** 현재 리스너를 제거한다. */
  removeListener(): void;
  /** 내부 버퍼를 초기화한다. */
  reset(): void;
}
