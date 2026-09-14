import { ManagedSerialPort } from '@/shared/SerialPort/ManagedSerialPort';
import { SerialPortTranslator } from '@/shared/SerialPort/SerialPortTranslator';
import type { SerialPortConnectionInfo } from '@/shared/SerialPort/types';
import { healthCheckStrategy } from '../strategy/deviceStrategies';

const HEALTH_CHECK_TIMEOUT_MS = 500;

export class SerialPortService {
  private readonly managedPort = ManagedSerialPort.shared(
    () => new ManagedSerialPort(),
  );
  private readonly healthCheckTranslator = new SerialPortTranslator(
    healthCheckStrategy,
  );

  async connect({ portPath, serialOptions }: SerialPortConnectionInfo) {
    await this.managedPort.connect({ portPath, serialOptions });
  }

  /** 포트 소유권 반납 — 백엔드 스캐너가 이 포트를 직접 열어 재탐지할 수 있게 한다(멱등). */
  async disconnect() {
    await this.managedPort.disconnect();
  }

  async healthCheck() {
    const command = this.healthCheckTranslator.encode(undefined);
    await this.managedPort.sendAndAwait(
      command,
      // TODO: 디바이스의 헬스체크 응답 조건에 맞게 수정
      (chunk) => chunk.length === 1,
      HEALTH_CHECK_TIMEOUT_MS,
    );
  }

  // TODO: 디바이스별 커맨드 메서드 추가
  // async exampleCommand(request: ExampleRequest): Promise<ExampleResponse> {
  //   const command = this.exampleTranslator.encode(request);
  //   const response = await this.managedPort.sendAndAwait(
  //     command,
  //     (chunk) => /* 응답 검증 조건 */,
  //     TIMEOUT_MS,
  //   );
  //   return this.exampleTranslator.decode(response);
  // }
}
