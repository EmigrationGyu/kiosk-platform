import { describe, expect, test } from 'bun:test';
import { createSerialQueue } from './serialize';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 밖에서 여닫는 약속 — 앞 작업이 끝나기 전에 뒤 작업이 들어오는 모양을 만든다. */
const gate = () => {
  let open = () => undefined as void;
  let fail = (_: Error) => undefined as void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
};

describe('직렬 큐', () => {
  test('앞이 끝나기 전엔 뒤가 시작하지 않는다 ★', async () => {
    const serial = createSerialQueue();
    const first = gate();
    const trace: string[] = [];

    const a = serial(async () => {
      trace.push('a:start');
      await first.promise;
      trace.push('a:end');
    });
    const b = serial(async () => {
      trace.push('b:start');
    });
    await tick();
    expect(trace).toEqual(['a:start']); // b 는 아직

    first.open();
    await Promise.all([a, b]);
    expect(trace).toEqual(['a:start', 'a:end', 'b:start']);
  });

  test('앞이 던져도 뒤는 돈다 — 실패는 그 지시의 결과이지 줄의 결과가 아니다', async () => {
    const serial = createSerialQueue();
    const a = serial(async () => {
      throw new Error('받기 실패');
    });
    const b = serial(async () => 'ok');

    await expect(a).rejects.toThrow('받기 실패');
    expect(await b).toBe('ok');
  });

  test('결과와 예외가 각자 호출부로 돌아간다', async () => {
    const serial = createSerialQueue();
    const results = await Promise.allSettled([
      serial(async () => 1),
      serial(async () => {
        throw new Error('둘째');
      }),
      serial(async () => 3),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
  });

  test('셋이 동시에 들어와도 들어온 순서다', async () => {
    const serial = createSerialQueue();
    const trace: number[] = [];
    await Promise.all(
      [3, 1, 2].map((n) =>
        serial(async () => {
          // 늦게 끝나는 것을 먼저 넣어도 순서가 바뀌지 않아야 한다.
          await new Promise((r) => setTimeout(r, n * 5));
          trace.push(n);
        }),
      ),
    );
    expect(trace).toEqual([3, 1, 2]);
  });
});
