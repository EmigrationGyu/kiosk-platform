import { EventEmitter } from 'events';
import net from 'net';
import { LogService } from 'src/service/LogService';
import type {
  IPersistentSocket,
  PersistentSocketOptions,
} from './IPersistentSocket';

// 리스너 없는 상태에서 예상 외 바이트가 누적되더라도 메모리가 무한 성장하지 않도록
// 둔 상한. 정상 DaouVP 응답은 최대 ~1KB 수준이라 64KB 는 충분히 넉넉한 방어선.
// 초과 시 전체를 버리고 다음 거래에서 새로 판정.
const MAX_PENDING_BYTES = 64 * 1024;

export class PersistentSocket
  extends EventEmitter
  implements IPersistentSocket
{
  private socket: net.Socket | null = null;
  private manualClose = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;

  /**
   * 'data' 이벤트 리스너가 부재한 동안 도착한 바이트를 보관.
   * EventEmitter 는 기본적으로 미구독 이벤트를 버퍼링하지 않으므로,
   * 요청-응답 쌍 사이에 흘러들어온 전문이 유실되는 걸 방지하기 위함.
   */
  private pendingChunks: Buffer[] = [];

  private readonly host: string;
  private readonly port: number;
  private readonly maxDelay: number;
  private readonly baseDelay: number;

  constructor(
    host: string,
    port: number,
    options: PersistentSocketOptions = {},
  ) {
    super();
    this.host = host;
    this.port = port;
    this.maxDelay = options.maxDelay ?? 5000;
    this.baseDelay = options.baseDelay ?? 100;

    // lazyConnect=true 면 ensureConnected() 첫 호출까지 doConnect 보류 — 단말 안 쓰는
    // 키오스크에서 무한 재연결 부수효과 회피. 기본은 즉시 시작 (기존 동작).
    if (!options.lazyConnect) {
      // 생성자에서 리스너 등록 후 첫 연결이 시작되도록 nextTick으로 지연
      process.nextTick(() => this.doConnect());
    }
  }

  get isConnected(): boolean {
    return !!(this.socket && !this.socket.destroyed && this.socket.writable);
  }

  /**
   * 첫 사용 시점에 connect 트리거 + 결과 await. 이벤트 기반 — connect 시 resolve,
   * error 시 reject. timeout 없음.
   *
   * 동일 인스턴스에서 동시에 여러 호출되면 각 promise 가 같은 connect/error 이벤트
   * 를 once 로 받아 동일 시점에 resolve/reject 됨 (EventEmitter 의 once 가 listener
   * 마다 호출되므로 race 없음).
   */
  async ensureConnected(): Promise<void> {
    if (this.isConnected) return;

    // lazyConnect=true 의 첫 호출, 또는 manualClose() 후 재개 — socket 도 없고
    // 재연결 타이머도 없는 상태면 doConnect 직접 시작.
    if (!this.socket && !this.retryTimer) {
      this.doConnect();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.off('connect', onConnect);
        this.off('error', onError);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      this.once('connect', onConnect);
      this.once('error', onError);
    });
  }

  write(data: string | Buffer): boolean {
    if (!this.isConnected) return false;
    return this.socket!.write(data);
  }

  takePending(): Buffer | null {
    if (this.pendingChunks.length === 0) return null;
    const buf = Buffer.concat(this.pendingChunks);
    this.pendingChunks = [];
    return buf;
  }

  close(): void {
    this.manualClose = true;
    this.clearRetryTimer();
    this.teardown();
  }

  private doConnect(): void {
    if (this.manualClose) return;
    this.teardown();

    const s = net.createConnection({ host: this.host, port: this.port });

    s.on('connect', () => {
      this.attempt = 0;
      this.clearRetryTimer();
      this.emit('connect');
    });

    s.on('data', (data: Buffer) => {
      // 구독자가 있으면 바로 전달, 없으면 버퍼에 쌓아 다음 takePending 호출 때 반환.
      if (this.listenerCount('data') > 0) {
        this.emit('data', data);
        return;
      }
      this.pendingChunks.push(data);
      const total = this.pendingChunks.reduce((n, b) => n + b.length, 0);
      if (total > MAX_PENDING_BYTES) {
        // 비정상 누적 — 전체 포기. 다음 거래 takePending 에서 null 받게 됨.
        LogService.getInstance().error(
          '[PersistentSocket] pendingChunks overflow — 전량 폐기',
          undefined,
          { unmasked: { totalBytes: total, limitBytes: MAX_PENDING_BYTES } },
        );
        this.pendingChunks = [];
      }
    });

    s.on('error', (err) => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      } else {
        LogService.getInstance().error(
          '[PersistentSocket] Unhandled socket error',
          err,
        );
      }
    });

    s.on('close', () => {
      this.emit('close');
      this.scheduleReconnect();
    });

    this.socket = s;
  }

  private teardown(): void {
    // 연결이 끊어지는 순간 이전 거래의 pending 바이트는 의미를 잃으므로 폐기.
    this.pendingChunks = [];
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.destroy();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.retryTimer) return;
    this.attempt += 1;
    const delay = this.computeDelay(this.attempt);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.doConnect();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private computeDelay(attempt: number): number {
    const jitter = Math.floor(Math.random() * 100);
    const exp = Math.pow(2, attempt) * this.baseDelay;
    return Math.min(this.maxDelay, exp + jitter);
  }
}
