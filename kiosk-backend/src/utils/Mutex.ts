/**
 * Promise 기반 비동기 뮤텍스.
 * 시리얼 디바이스처럼 한 번에 하나의 오퍼레이션만 허용해야 하는 리소스를 보호한다.
 *
 * 재진입 불가 — `runExclusive` 안에서 같은 뮤텍스를 다시 잡으면 데드락이다.
 */
export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  get isLocked(): boolean {
    return this.locked;
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
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
