import { Duplex } from 'node:stream';
import { Td200Simulator } from '../device-sim/td200';

/** 합성 포트 경로 — 실물 COM 이름과 겹치지 않게 둔다. */
export const LOOPBACK_PATH = 'LOOPBACK';

/**
 * 하드웨어 없이 도는 포트 — `@serial/Port` 의 개발·데모용 구현.
 *
 * `ManagedSerialPort` 가 쓰는 표면(`open`/`close`/`isOpen`/`write`/`pipe`/`on('data')`)만
 * 갖춘 Duplex 다. 상위 계층은 무엇과 말하는지 모르고, 그래서 **FSM·뮤텍스·폴링 예산이
 * 실물과 같은 코드 경로로 돈다** — 시뮬레이터를 위해 분기하는 코드가 한 줄도 없다.
 *
 * 응답을 다음 tick 으로 미루는 이유: 동기로 push 하면 `write()` 콜백보다 `data` 가 먼저
 * 나가 실물에선 불가능한 순서가 되고, 그 순서에 기대는 버그가 여기서만 안 잡힌다.
 */
export class SerialPort extends Duplex {
  private readonly sim: Td200Simulator;
  private opened = false;

  constructor(
    _options: { path: string; autoOpen?: boolean } & Record<string, unknown>,
  ) {
    // autoDestroy 를 끄는 이유: 기본값이면 쓰기·읽기 한쪽이 끝나는 순간 스트림이 스스로
    // 닫히며 'close' 를 쏘는데, `ManagedSerialPort` 는 그 이벤트를 **장치가 사라졌다**는
    // 뜻으로 읽고 포트를 릴리즈한다. 실물 포트는 스스로 닫지 않으므로 그 의미론을 맞춘다.
    super({ allowHalfOpen: true, autoDestroy: false });
    this.sim = new Td200Simulator();
  }

  /**
   * 포트 열거 — 스캐너가 쓴다. 합성 포트 하나를 돌려주면 탐지 경로가 실물과 같은
   * 모양으로 돈다(핸드셰이크까지 포함). 여기가 비면 아무리 I/O 를 흉내내도
   * `PORT_ASSIGNED` 가 안 나가 장치는 영영 미구성으로 남는다.
   */
  static async list(): Promise<{ path: string; manufacturer?: string }[]> {
    return [{ path: LOOPBACK_PATH, manufacturer: 'loopback' }];
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(callback?: (error: Error | null) => void): void {
    this.opened = true;
    queueMicrotask(() => callback?.(null));
  }

  /** serialport 고유 API — 버퍼가 없으므로 즉시 완료. 없으면 호출부가 TypeError 로 넘어진다. */
  drain(callback?: (error?: Error | null) => void): void {
    queueMicrotask(() => callback?.(null));
  }

  flush(callback?: (error?: Error | null) => void): void {
    queueMicrotask(() => callback?.(null));
  }

  close(callback?: (error?: Error | null) => void): void {
    this.opened = false;
    queueMicrotask(() => {
      this.emit('close');
      callback?.(null);
    });
  }

  override _read(): void {
    // push 는 쓰기에 대한 응답으로만 일어난다 — 장치는 먼저 말하지 않는다.
  }

  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    done: (error?: Error | null) => void,
  ): void {
    if (!this.opened) {
      done(new Error('port is not open'));
      return;
    }
    const response = this.sim.handle(chunk);
    done();
    queueMicrotask(() => this.push(response));
  }
}
