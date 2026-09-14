import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Logger } from '@/shared/Logger';
import { ManagedSerialPort } from './ManagedSerialPort';
import { ProtocolParser } from './ProtocolParser';

// Logger 는 최초 1회 tag 지정이 필요하다 (서브프로세스 index.ts 와 동일).
Logger.getInstance('test');

/**
 * sendAndAwait 의 리스너 수지 박제.
 *
 * 장치가 상태를 능동적으로 스트리밍하면(현금 방출기 등) 파서 버퍼가 항상 차 있어,
 * `customParser.onMessage()` 가 **동기로** onData→settle→cleanup 까지 돌아버린다.
 * 이때 포트 리스너를 파서보다 늦게 걸면 cleanup 이 아직 없는 리스너를 지우려 하고,
 * 그 뒤에 등록된 error/close 는 영영 제거되지 않아 호출마다 2개씩 누적된다
 * (실측: 25회 호출에서 MaxListenersExceededWarning).
 *
 * 그래서 "요청이 끝나면 포트 리스너가 0으로 돌아온다"를 여기서 고정한다.
 */

/** 버퍼 전체를 한 프레임으로 보는 최소 파서 — 동기 drain 동작만 재현하면 충분하다. */
class WholeBufferParser extends ProtocolParser {
  protected tryExtract(): Buffer | null {
    return this.buffer.length > 0 ? Buffer.from(this.buffer) : null;
  }
}

/** write/drain 만 즉시 성공시키는 가짜 포트. 리스너 수지를 관찰하는 게 목적이다. */
function createFakePort() {
  const port = new EventEmitter() as EventEmitter & {
    write(data: unknown, cb: (err?: Error | null) => void): void;
    drain(cb: (err?: Error | null) => void): void;
  };
  port.write = (_data, cb) => cb(null);
  port.drain = (cb) => cb(null);
  return port;
}

function createManagedPort() {
  const parser = new WholeBufferParser();
  const port = createFakePort();
  const managed = new ManagedSerialPort({ messageParser: parser });
  // 실제 OS 핸들 없이 sendAndAwait 경로만 태운다.
  Object.assign(managed as unknown as Record<string, unknown>, {
    port,
    lastInfo: { portPath: 'COM-TEST', serialOptions: {} },
  });
  return { managed, parser, port };
}

const RESPONSE = Buffer.from([0xfe, 0x12, 0x13]);
const anyMessage = () => true;

describe('ManagedSerialPort.sendAndAwait — 리스너 수지', () => {
  test('버퍼가 이미 차 있어 동기로 응답해도 포트 리스너가 남지 않는다', async () => {
    const { managed, parser, port } = createManagedPort();
    // 장치가 미리 밀어넣은 상태 패킷 — 이게 있으면 onMessage 가 동기 호출된다.
    parser.feed(RESPONSE);

    await managed.sendAndAwait(Buffer.from([0x01]), anyMessage, 500);

    expect(port.listenerCount('error')).toBe(0);
    expect(port.listenerCount('close')).toBe(0);
  });

  test('반복 호출에도 누적되지 않는다', async () => {
    const { managed, parser, port } = createManagedPort();

    for (let i = 0; i < 20; i++) {
      parser.feed(RESPONSE);
      await managed.sendAndAwait(Buffer.from([0x01]), anyMessage, 500);
    }

    // 고치기 전에는 여기서 40개가 쌓여 MaxListenersExceededWarning 이 났다.
    expect(port.listenerCount('error')).toBe(0);
    expect(port.listenerCount('close')).toBe(0);
  });

  test('비동기로 응답이 와도 정리된다', async () => {
    const { managed, parser, port } = createManagedPort();

    const pending = managed.sendAndAwait(Buffer.from([0x01]), anyMessage, 500);
    // sendAndAwait 는 큐(마이크로태스크)를 거치므로, 리스너가 실제로 걸릴 때까지 양보한다.
    // 이걸 안 하면 버퍼가 먼저 차서 위 테스트와 같은 동기 경로를 타버린다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    parser.feed(RESPONSE);
    await pending;

    expect(port.listenerCount('error')).toBe(0);
    expect(port.listenerCount('close')).toBe(0);
  });

  test('타임아웃으로 끝나도 정리된다', async () => {
    const { managed, port } = createManagedPort();

    await expect(
      managed.sendAndAwait(Buffer.from([0x01]), anyMessage, 10),
    ).rejects.toThrow();

    expect(port.listenerCount('error')).toBe(0);
    expect(port.listenerCount('close')).toBe(0);
  });
});
