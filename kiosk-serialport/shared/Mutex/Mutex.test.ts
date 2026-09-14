import { describe, expect, test } from 'bun:test';
import { DEVICE_CHANNEL_CAUSE } from 'kiosk-types';
import { Mutex, MutexPurgedError } from './Mutex';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * purge 는 **동기로** reject 하므로, 대기 프라미스에 핸들러가 붙기 전에 거부되면
 * 미처리 거부로 잡힌다. 대기 작업은 만들자마자 핸들러를 달아 결과만 나중에 확인한다.
 */
const queueOp = (mutex: Mutex, onRun: () => void) => {
  const promise = mutex.runExclusive(async () => {
    onRun();
  });
  const settled = promise.then(
    () => ({ ok: true, error: undefined as unknown }),
    (error: unknown) => ({ ok: false, error }),
  );
  return settled;
};

/** 완료 시점을 테스트가 제어하는 작업. */
const deferred = () => {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { done, release };
};

describe('Mutex — 기본 직렬화', () => {
  test('점유 중이면 뒤 작업은 앞 작업이 끝난 뒤에 실행된다', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const first = deferred();

    const a = mutex.runExclusive(async () => {
      order.push('a:start');
      await first.done;
      order.push('a:end');
    });
    const b = mutex.runExclusive(async () => {
      order.push('b:start');
    });

    await tick();
    expect(order).toEqual(['a:start']); // b 는 아직 대기

    first.release();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  test('작업이 throw 해도 락은 풀린다', async () => {
    const mutex = new Mutex();
    await expect(
      mutex.runExclusive(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(mutex.isLocked).toBe(false);
  });
});

describe('Mutex.purge — 비상 복구', () => {
  test('대기 중인 요청을 전부 거절하고, 점유자는 건드리지 않는다', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const holder = deferred();

    const running = mutex.runExclusive(async () => {
      order.push('holder:start');
      await holder.done;
      order.push('holder:end');
      return 'holder-result';
    });
    const queued1 = queueOp(mutex, () => order.push('queued1'));
    const queued2 = queueOp(mutex, () => order.push('queued2'));

    await tick();
    expect(mutex.pendingCount).toBe(2);

    mutex.purge(new MutexPurgedError('test'));

    expect((await queued1).ok).toBe(false);
    expect((await queued2).ok).toBe(false);

    // 점유자는 살아서 정상 완료 — purge 는 큐만 건드린다.
    holder.release();
    expect(await running).toBe('holder-result');
    expect(order).toEqual(['holder:start', 'holder:end']);
  });

  test('거절된 요청은 **실행되지 않는다** — resolve 가 아니라 reject 여야 하는 이유', async () => {
    const mutex = new Mutex();
    let ranCount = 0;
    const holder = deferred();

    const running = mutex.runExclusive(() => holder.done);
    const queued = queueOp(mutex, () => {
      ranCount += 1;
    });

    await tick();
    mutex.purge(new MutexPurgedError('test'));
    expect((await queued).ok).toBe(false);

    holder.release();
    await running;
    await tick();

    // 전부 resolve 했다면 대기하던 명령이 한꺼번에 채널로 쏟아졌을 것.
    expect(ranCount).toBe(0);
  });

  test('거절 사유는 MutexPurgedError 로 식별된다', async () => {
    const mutex = new Mutex();
    const holder = deferred();
    const running = mutex.runExclusive(() => holder.done);
    const queued = queueOp(mutex, () => undefined);

    await tick();
    mutex.purge(new MutexPurgedError('device reset requested'));

    const { error } = await queued;
    expect(error).toBeInstanceOf(MutexPurgedError);
    expect((error as Error).name).toBe(DEVICE_CHANNEL_CAUSE.OPERATION_PURGED);
    expect((error as Error).message).toContain('device reset requested');

    holder.release();
    await running;
  });

  test('purge 후에도 뮤텍스는 계속 쓸 수 있다 (락이 새지 않음)', async () => {
    const mutex = new Mutex();
    const holder = deferred();
    const running = mutex.runExclusive(() => holder.done);
    const queued = queueOp(mutex, () => undefined);

    await tick();
    mutex.purge(new MutexPurgedError('test'));
    expect((await queued).ok).toBe(false);

    holder.release();
    await running;
    expect(mutex.isLocked).toBe(false);
    expect(await mutex.runExclusive(async () => 'ok')).toBe('ok');
  });

  test('대기가 없으면 no-op', () => {
    const mutex = new Mutex();
    expect(mutex.pendingCount).toBe(0);
    expect(() => mutex.purge(new MutexPurgedError('test'))).not.toThrow();
  });
});
