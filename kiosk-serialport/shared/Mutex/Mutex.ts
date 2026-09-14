import { DEVICE_CHANNEL_CAUSE } from 'kiosk-types';

/**
 * Promise 기반 비동기 뮤텍스 — 시리얼 디바이스처럼 한 번에 하나의 오퍼레이션만 허용해야 하는 리소스를
 * 보호한다.
 *
 * **대기 프라미스에는 즉시 `await` 또는 `.catch` 를 붙여야 한다.** `purge()` 가 microtask 를 거치지 않고
 * **동기로** 대기자를 reject 하므로, fire-and-forget 으로 던져두면 그 자리에서 unhandledRejection 이 난다.
 */
/**
 * 비상 복구로 인해 대기가 무효화됐음을 알리는 에러.
 *
 * `name` 을 types 의 `DEVICE_CHANNEL_CAUSE.OPERATION_PURGED` 로 고정한다 — IPC 경계를
 * 넘는 것은 클래스가 아니라 이 문자열이라, 세 레포가 같은 값을 보려면 식별자가 types 에
 * 있어야 한다. **비재시도 분류**다(`PortNotConfiguredError` 와 같은 취급).
 */
export class MutexPurgedError extends Error {
  constructor(reason: string) {
    super(`Pending device operation was cancelled: ${reason}`);
    this.name = DEVICE_CHANNEL_CAUSE.OPERATION_PURGED;
  }
}

type Waiter = { resolve: () => void; reject: (reason: Error) => void };

export class Mutex {
  private queue: Waiter[] = [];
  private locked = false;

  get isLocked(): boolean {
    return this.locked;
  }

  /** 현재 획득을 기다리는 요청 수. 진단/로그용. */
  get pendingCount(): number {
    return this.queue.length;
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  /**
   * 대기 중인 획득 요청을 **전부 거절**한다. 점유 중인 연산은 건드리지 않는다.
   *
   * 비상 복구(리셋)용이다. 큐가 FIFO 라 리셋이 진행 중 연산을 끊어도 리셋보다 먼저 줄 서 있던 요청들이
   * **리셋보다 앞서** 실행된다 — 방금 중단돼 카드 위치도 모르는 장비에 대고. resolve 가 아니라 reject
   * 인 것이 핵심이다: 전부 resolve 하면 대기하던 명령이 한꺼번에 시리얼 채널로 쏟아져 뮤텍스가 막던
   * 바로 그 사고가 난다. 점유자를 멈추는 건 호출부가 abort 신호로 따로 처리한다.
   */
  purge(reason: Error): void {
    if (this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    for (const waiter of pending) waiter.reject(reason);
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
