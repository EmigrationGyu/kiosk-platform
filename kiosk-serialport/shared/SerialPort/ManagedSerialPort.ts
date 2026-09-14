import { SerialPort } from '@serial/Port';
import { InterByteTimeoutParser } from '@serialport/parser-inter-byte-timeout';
import { Logger } from '@/shared/Logger';
import type { MessageParser, SerialPortConnectionInfo } from './types';

export type { SerialPortConnectionInfo };

const DEFAULT_INTER_BYTE_TIMEOUT_MS = 50;

type PortOptions = ConstructorParameters<typeof SerialPort>[0];

// HMR(vite-node --watch)을 넘어 살아남아야 하는 프로세스 스코프 싱글턴 슬롯. 모듈 재평가에 영향받지
// 않도록 globalThis 에 둔다(electron spawnChildProcesses 의 레지스트리와 동일 idiom).
const SHARED_REGISTRY_KEY = '__MANAGED_SERIAL_PORT__';

/**
 * connect() 를 한 번도 받지 못한 상태에서 포트를 사용하려 한 경우. connect() 없이는 치유 불가능한
 * 전제조건 위반이라 재시도 루프(transact 등)는 이 에러를 잡으면 즉시 단념해야 한다 — 재시도해봤자
 * 뮤텍스 점유만 늘려 PORT_ASSIGNED 처리(=치유 그 자체)를 뒤로 민다.
 */
export class PortNotConfiguredError extends Error {
  constructor(action: string) {
    super(
      `Serial port is not configured. Call connect() at least once before ${action}.`,
    );
    this.name = 'PortNotConfiguredError';
  }
}

/**
 * 시리얼 포트 생명주기를 관리하는 래퍼.
 *
 * - connect() 로 한 번도 설정을 받지 못한 상태에서 포트를 **사용**하려 하면 즉시 throw
 *   (disconnect() 는 예외 — 목표 상태가 이미 달성된 것이므로 멱등 no-op)
 * - error/close 이벤트 발생 시 포트를 즉시 릴리즈하고 끝 (재연결은 상위에서 처리)
 * - sendAndAwait 는 내부 큐를 통해 순차 실행된다 (동시 요청 시 응답 혼재 방지)
 * - 바이트 단편화는 messageParser 가 있으면 프로토콜 구조로, 없으면 InterByteTimeoutParser 로 해소
 */
export class ManagedSerialPort {
  private readonly logger = Logger.getInstance();
  private lastInfo: SerialPortConnectionInfo | null = null;
  private port: SerialPort | null = null;
  private parser: InterByteTimeoutParser | null = null;
  private releaseInFlight: Promise<void> | null = null;
  private sendQueue: Promise<unknown> = Promise.resolve();
  private readonly interByteTimeoutMs: number;
  private readonly customParser: MessageParser | null;

  /**
   * 포트 생성자. 기본값은 `@serial/Port` 가 해소한 것(빌드 타깃이 고른 구현)이다.
   *
   * 주입 지점을 따로 두는 이유: alias 는 **빌드 시점** 선택이라 하드웨어 없는 CI 에서
   * 이 클래스를 실물 포트로 컴파일한 채 검증할 방법이 없다. 여기 하나를 열어두면 그
   * 경우에도 같은 코드 경로가 돈다 — 테스트 전용 분기를 본문에 넣지 않는다.
   */
  private readonly createPort: (options: PortOptions) => SerialPort;

  constructor(options?: {
    interByteTimeoutMs?: number;
    messageParser?: MessageParser;
    portFactory?: (options: PortOptions) => SerialPort;
  }) {
    this.interByteTimeoutMs =
      options?.interByteTimeoutMs ?? DEFAULT_INTER_BYTE_TIMEOUT_MS;
    this.customParser = options?.messageParser ?? null;
    this.createPort = options?.portFactory ?? ((o) => new SerialPort(o));
  }

  /**
   * 프로세스 스코프 싱글턴 접근자.
   *
   * 실제 OS 핸들·sendQueue·parser 스트림 상태를 소유한 ManagedSerialPort 는 한 번만 만들어져
   * HMR(vite-node --watch)을 넘어 생존해야 한다. 상위 로직은 reload 마다 새로 생성되더라도 이 메서드로
   * 동일 인스턴스를 주입받아 연결을 유지한다 — 핸들 누수/EBUSY 없이 비즈니스 로직만 갱신된다.
   * 서브프로세스 1개 = 디바이스 1개 = 포트 1개라 프로세스당 단일 슬롯으로 충분하다.
   */
  static shared(factory: () => ManagedSerialPort): ManagedSerialPort {
    const registry = globalThis as unknown as Record<
      string,
      ManagedSerialPort | undefined
    >;
    return (registry[SHARED_REGISTRY_KEY] ??= factory());
  }

  public async connect(info: SerialPortConnectionInfo) {
    this.logger.info('[SerialPort] connect()', {
      unmasked: {
        portPath: info.portPath,
      },
    });
    this.lastInfo = info;

    // 기존 포트가 있으면 정책상 일단 릴리즈하고 새로 연다.
    await this.release();

    const port = this.createPort({
      path: info.portPath,
      ...(info.serialOptions as unknown as Omit<
        PortOptions,
        'path' | 'autoOpen'
      >),
      autoOpen: false,
    });

    // 이벤트는 open 성공 이후만 붙여서, open 실패 시엔 깔끔하게 정리 후 throw.
    try {
      await new Promise<void>((resolve, reject) => {
        port.open((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      this.logger.info(`[SerialPort] connect() port opened successfully`);
    } catch (e) {
      this.logger.error(`[SerialPort] connect() port open failed`, e);
      // open 과정에서 문제 발생 시 바로 릴리즈
      try {
        await this.releasePort(port);
      } catch {
        // ignore
      }
      throw e;
    }

    if (this.customParser) {
      this.customParser.reset();
      port.on('data', (chunk: Buffer) => this.customParser?.feed(chunk));
    } else {
      const parser = port.pipe(
        new InterByteTimeoutParser({ interval: this.interByteTimeoutMs }),
      );
      this.parser = parser;
    }

    this.port = port;
    this.attachLifecycleHandlers(port);
  }

  /**
   * 포트를 놓는다. **멱등** — 한 번도 connect 되지 않았거나 이미 릴리즈된 상태면 no-op 이다. 목표 상태가
   * "포트를 쥐고 있지 않음"이라 미연결은 실패가 아니라 이미 달성된 상태고, 호출부가 "안 쥐고 있음"과
   * "못 놓았음"을 구분할 필요가 없어진다.
   */
  public async disconnect() {
    await this.release();
  }

  /** connect 정보를 한 번도 받지 못했으면 throw 한다. */
  public getPortOrThrow(): SerialPort {
    if (!this.lastInfo) {
      throw new PortNotConfiguredError('using the port');
    }
    if (!this.port) {
      throw new Error('Serial port is not connected (released).');
    }
    return this.port;
  }

  /**
   * 데이터를 보내고 drain까지 대기한다. 응답을 기대하지 않는 fire-and-forget 전송.
   */
  public async write(data: Buffer): Promise<void> {
    this.logger.info('[SerialPort] write()', {
      unmasked: {
        data: data.toString('hex'),
      },
    });
    const port = this.getPortOrThrow();
    await this.writeAndDrain(port, data);
  }

  /**
   * 커스텀 파서의 내부 버퍼/리스너를 초기화한다 — 재시도·오류 복구 시 이전 응답의 잔류 바이트가 다음
   * 매칭에 새지 않도록. 파서가 없거나 InterByteTimeoutParser 경로면 no-op.
   */
  public resetParser(): void {
    if (!this.customParser) return;
    this.customParser.removeListener();
    this.customParser.reset();
  }

  /**
   * 데이터를 보내고 기대하는 응답이 올 때까지 data 이벤트를 감시한다(expect = 버퍼 exact match 또는 판별 함수).
   * write/drain 실패는 포트를 릴리즈하고(물리적 통신 오류), 타임아웃은 포트를 유지한 채 throw 한다(논리적 오류).
   * 내부 큐로 순차 실행되어 동시 호출 시에도 응답이 섞이지 않는다.
   */
  public sendAndAwait(
    data: Buffer,
    expect: Buffer | ((chunk: Buffer) => boolean),
    timeoutMs: number,
  ): Promise<Buffer> {
    const task = this.sendQueue.then(() =>
      this.executeSendAndAwait(data, expect, timeoutMs),
    );
    // 이전 요청 실패가 큐 전체를 막지 않도록 catch로 체이닝
    this.sendQueue = task.catch(() => {
      /* prevent queue stall */
    });
    return task;
  }

  private executeSendAndAwait(
    data: Buffer,
    expect: Buffer | ((chunk: Buffer) => boolean),
    timeoutMs: number,
  ): Promise<Buffer> {
    this.logger.info('[SerialPort] sendAndAwait()', {
      unmasked: {
        tx: data.toString('hex'),
        timeout: timeoutMs,
      },
    });
    const port = this.getPortOrThrow();

    if (!this.parser && !this.customParser) {
      return Promise.reject(new Error('No parser configured.'));
    }

    const match =
      typeof expect === 'function'
        ? expect
        : (chunk: Buffer) => chunk.equals(expect);

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        if (this.customParser) {
          this.customParser.removeListener();
        } else {
          this.parser?.removeListener('data', onData);
        }
        port.removeListener('error', onError);
        port.removeListener('close', onClose);
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const timer = setTimeout(() => {
        this.logger.error('[SerialPort] sendAndAwait() TIMEOUT', undefined, {
          unmasked: { timeoutMs, tx: data.toString('hex') },
        });
        settle(() => {
          this.customParser?.reset();
          reject(new Error(`Response timed out after ${timeoutMs}ms`));
        });
      }, timeoutMs);

      const onData = (chunk: Buffer) => {
        if (!match(chunk)) {
          this.logger.warn('[SerialPort] sendAndAwait() non-matching message', {
            unmasked: {
              discarded: chunk.toString('hex'),
            },
          });
          return;
        }
        this.logger.info('[SerialPort] sendAndAwait()', {
          unmasked: {
            rx: chunk.toString('hex'),
          },
        });
        settle(() => resolve(chunk));
      };

      const onError = (err: Error) => {
        this.logger.error(`[SerialPort] sendAndAwait() port error`, err);
        settle(() => reject(err));
      };

      const onClose = () => {
        this.logger.error(
          `[SerialPort] sendAndAwait() port closed while awaiting`,
        );
        settle(() =>
          reject(new Error('Serial port closed while awaiting response')),
        );
      };

      // 리스너를 write 전에 등록해 즉시 응답을 수신할 수 있게 한다. 포트 리스너가 **파서보다 먼저**여야
      // 한다: customParser.onMessage() 는 버퍼에 이미 데이터가 있으면 그 자리에서 동기로
      // onData→settle→cleanup 까지 돌아버려, 아직 등록되지 않은 error/close 를 cleanup 이 제거하지
      // 못하고 호출마다 포트에 영구히 쌓인다(장치가 상태를 계속 스트리밍하면 매 호출 해당).
      port.prependOnceListener('error', onError);
      port.prependOnceListener('close', onClose);

      if (this.customParser) {
        this.customParser.onMessage(onData);
      } else if (this.parser) {
        this.parser.on('data', onData);
      }

      // 리스너 등록 후 전송
      this.writeAndDrain(port, data).catch((writeErr) => {
        settle(() => reject(writeErr));
      });
    });
  }

  private async writeAndDrain(
    port: SerialPort,
    data: string | Uint8Array | Buffer,
  ) {
    try {
      await new Promise<void>((resolve, reject) => {
        port.write(data, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        port.drain((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (e) {
      await this.release().catch(() => {
        // ignore
      });
      throw e;
    }
  }

  private attachLifecycleHandlers(port: SerialPort) {
    // error/close 시에는 그냥 릴리즈하고 끝 (재연결은 상위에서 처리)
    port.on('error', (err) => {
      this.logger.error(`[SerialPort] port 'error' event`, err);
      this.release().catch(() => {
        // ignore
      });
    });
    port.on('close', () => {
      this.logger.info(`[SerialPort] port 'close' event`);
      this.release().catch(() => {
        // ignore
      });
    });
  }

  private async release() {
    if (this.releaseInFlight) return this.releaseInFlight;
    this.releaseInFlight = (async () => {
      if (!this.port) return;
      this.logger.info(`[SerialPort] release() releasing port`);
      const current = this.port;
      const currentParser = this.parser;
      this.port = null;
      this.parser = null;
      this.customParser?.removeListener();
      this.customParser?.reset();
      await this.releasePort(current, currentParser);
    })();
    try {
      await this.releaseInFlight;
    } finally {
      this.releaseInFlight = null;
    }
  }

  private async releasePort(
    port: SerialPort,
    parser?: InterByteTimeoutParser | null,
  ) {
    try {
      if (parser) {
        parser.removeAllListeners();
        parser.destroy();
      }
    } catch {
      // ignore
    }

    try {
      port.removeAllListeners();
    } catch {
      // ignore
    }

    // 이미 닫혀있으면 close가 에러 날 수 있으니 방어적으로 처리
    if (port.isOpen) {
      await new Promise<void>((resolve) => {
        port.close(() => resolve());
      });
    }

    // 일부 환경에선 close로도 리소스가 남는 케이스가 있어 destroy까지 시도
    try {
      port.destroy();
    } catch {
      // ignore
    }
  }
}
