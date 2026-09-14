import { describe, expect, test } from 'bun:test';
import { createReadyGate, type ReadyHandle } from './readyGate';

/** 준비 시점을 시험이 쥐는 handle. */
function pendingHandle(): ReadyHandle & {
  markReady(): void;
  fail(e: unknown): void;
} {
  let done: () => void = () => undefined;
  let fail: (e: unknown) => void = () => undefined;
  const ready = new Promise<void>((res, rej) => {
    done = res;
    fail = rej;
  });
  return { ready, markReady: () => done(), fail: (e) => fail(e) };
}

const gate = () => createReadyGate(1000, 'test');

describe('createReadyGate', () => {
  test('통과 전에는 준비되지 않은 것으로 본다', () => {
    const g = gate();
    expect(g.isReady(pendingHandle())).toBe(false);
  });

  test('ready 가 풀리면 통과하고, 그 뒤로는 기다리지 않는다', async () => {
    const g = gate();
    const handle = pendingHandle();
    const waiting = g.wait(handle);
    expect(g.isReady(handle)).toBe(false); // 아직 — 요청 시계를 걸면 안 되는 구간
    handle.markReady();
    await waiting;
    expect(g.isReady(handle)).toBe(true); // 이후 요청은 곧장 나간다
  });

  test('예산을 넘기면 reject — 요청 타임아웃과 구별되는 문구', async () => {
    const g = createReadyGate(20, 'cardkey-dispenser');
    const handle = pendingHandle(); // 영영 준비되지 않음
    await expect(g.wait(handle)).rejects.toThrow(/spawn\/connect timeout/);
    expect(g.isReady(handle)).toBe(false);
  });

  test('ready 가 reject 되면 그 이유를 그대로 올린다', async () => {
    const g = gate();
    const handle = pendingHandle();
    const waiting = g.wait(handle);
    handle.fail(new Error('런타임을 받지 못했습니다'));
    await expect(waiting).rejects.toThrow('런타임을 받지 못했습니다');
  });

  test('세대가 갈리면 다시 기다린다 — 죽은 세대의 준비를 물려주지 않는다', async () => {
    const g = gate();
    const first = pendingHandle();
    const firstWait = g.wait(first);
    first.markReady();
    await firstWait;
    expect(g.isReady(first)).toBe(true);

    // 회수·크래시 후 재spawn — ensure 가 새 handle 을 준다.
    const second = pendingHandle();
    expect(g.isReady(second)).toBe(false);
    const secondWait = g.wait(second);
    second.markReady();
    await secondWait;
    expect(g.isReady(second)).toBe(true);
    // 옛 세대는 더 이상 통과가 아니다.
    expect(g.isReady(first)).toBe(false);
  });

  test('같은 세대를 여러 요청이 동시에 기다려도 모두 풀린다', async () => {
    const g = gate();
    const handle = pendingHandle();
    const waits = [g.wait(handle), g.wait(handle), g.wait(handle)];
    handle.markReady();
    await Promise.all(waits);
    expect(g.isReady(handle)).toBe(true);
  });

  test('통과 후에는 타이머가 남지 않는다 — 대기마다 예약된 것을 거둔다', async () => {
    const scheduled: (() => void)[] = [];
    const cancelled: unknown[] = [];
    const g = createReadyGate(
      1000,
      'test',
      () => 0,
      (fn) => {
        scheduled.push(fn);
        return scheduled.length - 1;
      },
      (id) => cancelled.push(id),
    );
    const handle = pendingHandle();
    const waiting = g.wait(handle);
    handle.markReady();
    await waiting;
    expect(cancelled).toEqual([0]);
  });
});
