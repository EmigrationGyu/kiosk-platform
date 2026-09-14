import { describe, expect, test } from 'bun:test';
import { createSingleFlight } from './singleFlight';

/** 외부에서 완료 시점을 제어할 수 있는 약속. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createSingleFlight', () => {
  test('실행 중 재호출은 task 를 새로 시작하지 않고 같은 약속에 합류한다', async () => {
    const flight = createSingleFlight();
    const gate = deferred();
    let started = 0;

    const first = flight.run(() => {
      started += 1;
      return gate.promise;
    });
    const second = flight.run(() => {
      started += 1;
      return Promise.resolve();
    });

    expect(started).toBe(1);
    expect(second).toBe(first); // 같은 약속 — 호출자가 완료를 await 할 수 있다

    gate.resolve();
    await first;
    expect(started).toBe(1);
  });

  test('완료 후에는 다시 실행할 수 있다 (래치가 풀린다)', async () => {
    const flight = createSingleFlight();
    let started = 0;
    const task = () => {
      started += 1;
      return Promise.resolve();
    };

    await flight.run(task);
    expect(flight.current()).toBeNull();

    await flight.run(task);
    expect(started).toBe(2);
  });

  test('task 가 실패해도 래치가 잠긴 채 남지 않는다', async () => {
    const flight = createSingleFlight();

    await expect(
      flight.run(() => Promise.reject(new Error('정리 실패'))),
    ).rejects.toThrow('정리 실패');
    expect(flight.current()).toBeNull();

    // 동기 throw 도 마찬가지 — 래치가 영구히 잠기면 이후 홈 복귀가 전부 막힌다.
    await expect(
      flight.run(() => {
        throw new Error('동기 실패');
      }),
    ).rejects.toThrow('동기 실패');
    expect(flight.current()).toBeNull();
  });

  test('current() 는 실행 중에만 진행 중인 약속을 노출한다', async () => {
    const flight = createSingleFlight();
    const gate = deferred();

    expect(flight.current()).toBeNull();
    const running = flight.run(() => gate.promise);
    expect(flight.current()).toBe(running);

    gate.resolve();
    await running;
    expect(flight.current()).toBeNull();
  });
});
