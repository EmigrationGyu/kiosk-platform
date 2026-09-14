import type { SerialPortOpenOptions } from 'serialport';
import type { DeviceId } from 'src/constant/events/Hardware';

export type DetectionResult = {
  deviceId: DeviceId;
  portPath: string;
  serialOptions: SerialPortOpenOptions<unknown>;
};

type Expect = Buffer | ((data: Buffer) => boolean);

type HandshakeBase = {
  /** 시리얼 포트 옵션 (baudRate, dataBits 등) */
  serialOptions: Omit<SerialPortOpenOptions<unknown>, 'path' | 'autoOpen'>;
  /** 주 옵션 실패 시 시도할 폴백 옵션 목록 (e.g. 다른 baudRate) */
  fallbackOptions?: Omit<SerialPortOpenOptions<unknown>, 'path' | 'autoOpen'>[];
  /** 응답 대기 타임아웃 (ms). 기본값 500 */
  timeout?: number;
};

/**
 * 핸드쉐이크 — request/expect 는 둘 다 scalar 이거나 둘 다 array 여야 한다
 * (discriminated union 으로 강제). array 인 경우 두 배열의 길이는 runtime 에
 * 검증되며, 각 인덱스가 한 round-trip 의 송신/매칭 페어를 이룬다.
 */
type Handshake =
  | (HandshakeBase & {
      /** 포트에 전송할 요청 바이트 */
      request: Buffer;
      /** 기대 응답 — 정확한 버퍼 일치 또는 커스텀 판정 함수 */
      expect: Expect;
    })
  | (HandshakeBase & {
      /** 순차 송신할 요청 바이트 배열 — 각 단계 사이에 RX 버퍼 flush */
      request: Buffer[];
      /** 각 단계의 기대 응답. request 와 동일한 길이여야 함 */
      expect: Expect[];
    });

export interface DeviceProbe {
  /** 기기 식별자 (DEVICE_IDS 의 값 중 하나) */
  readonly deviceId: DeviceId;

  /** 핸드쉐이크 프로토콜 정의 */
  readonly handshake: Handshake;

  /** 탐지 성공 시 호출 — probe가 자신의 transport를 통해 직접 디스패치 */
  onDetected(result: DetectionResult): Promise<void>;

  /** 하위 프로세스에 ping — 에러 상태면 reject */
  healthCheck(): Promise<void>;

  /**
   * 서브프로세스가 쥔 COM 포트를 놓게 한다 — **재탐지(포트 직접 open)의 전제조건**.
   *
   * 정상 동작 중인 디바이스의 포트는 서브프로세스가 열어둔 상태라 스캐너가 열 수 없다.
   * 이걸 먼저 놓게 하지 않으면 rescan 이 EBUSY 로 확정 실패하고, lease 를 영영 못 되찾는다.
   */
  release(): Promise<void>;
}
