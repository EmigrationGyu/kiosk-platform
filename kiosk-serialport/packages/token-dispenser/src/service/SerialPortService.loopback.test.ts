import { describe, expect, it } from 'bun:test';
import { Logger } from '@/shared/Logger';
import { SerialPort as LoopbackPort } from '@/shared/SerialPort/impl/loopback';
import { ManagedSerialPort } from '@/shared/SerialPort/ManagedSerialPort';
import { TD200ProtocolParser } from '../utils/TD200ProtocolParser';
import { SerialPortService } from './SerialPortService';

Logger.getInstance('test');

/**
 * 루프백 포트를 물린 **끝단 검증** — 전략 인코딩 → 프레이밍 → 파서 → FSM 전이 → 폴링
 * 예산까지 실장비와 **같은 코드 경로**가 돈다. 시뮬레이터를 위해 분기한 코드가 한 줄도
 * 없다는 것이 이 스위트의 논점이다.
 *
 * `ManagedSerialPort` 는 프로세스 스코프 싱글턴이라 서비스가 만들기 전에 자리를 선점한다.
 * alias(`@serial/Port`)는 빌드 시점 선택이고 이쪽은 런타임 주입 — 둘은 같은 구현을 고르는
 * 다른 축이다.
 */
const seedLoopbackPort = () => {
  const registry = globalThis as unknown as Record<string, unknown>;
  registry.__MANAGED_SERIAL_PORT__ = undefined;
  ManagedSerialPort.shared(
    () =>
      new ManagedSerialPort({
        messageParser: new TD200ProtocolParser(),
        portFactory: (o) => new LoopbackPort(o) as never,
      }),
  );
};

const connect = async () => {
  seedLoopbackPort();
  const service = new SerialPortService();
  await service.connect({
    portPath: 'LOOPBACK',
    serialOptions: { baudRate: 9600 },
  });
  return service;
};

describe('SerialPortService — 루프백 끝단', () => {
  it('상태를 읽는다 — 파싱까지 통과한 객체가 나온다', async () => {
    const service = await connect();
    const status = await service.getStatus();
    expect(status.tokenEmpty).toBe(false);
    expect(status.tokenAtGate).toBe(false);
  });

  it('방출하면 토큰이 게이트에 선다 — FSM 이 모터 정지까지 기다린다', async () => {
    const service = await connect();
    const status = await service.dispense();
    expect(status.tokenAtGate).toBe(true);
    expect(status.dispensing).toBe(false);
  });

  it('리셋은 진행 중 동작을 걷어낸다', async () => {
    const service = await connect();
    const status = await service.reset();
    expect(status.tokenJam).toBe(false);
    expect(status.commandNotExecutable).toBe(false);
  });
});
