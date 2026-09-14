import { describe, expect, test } from 'bun:test';
import { createReadinessWatchdog } from './readinessWatchdog';

function makeClock() {
  const timers = new Map<number, { fn: () => void; at: number }>();
  let next = 1;
  let now = 0;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

describe('준비 감시', () => {
  test('상한을 넘도록 준비 선언이 없으면 복구를 부른다', () => {
    const clock = makeClock();
    let recovered = 0;
    const watchdog = createReadinessWatchdog({
      timeoutMs: 30_000,
      onTimeout: () => {
        recovered += 1;
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    watchdog.arm();
    clock.advance(29_999);
    expect(recovered).toBe(0);

    clock.advance(1);
    expect(recovered).toBe(1);
  });

  test('준비 선언이 오면 복구하지 않는다', () => {
    const clock = makeClock();
    let recovered = 0;
    const watchdog = createReadinessWatchdog({
      timeoutMs: 30_000,
      onTimeout: () => {
        recovered += 1;
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    watchdog.arm();
    watchdog.disarm();
    clock.advance(60_000);

    expect(recovered).toBe(0);
    expect(clock.pending).toBe(0);
  });

  test('재기동이 겹쳐도 감시는 하나만 돈다', () => {
    const clock = makeClock();
    let recovered = 0;
    const watchdog = createReadinessWatchdog({
      timeoutMs: 30_000,
      onTimeout: () => {
        recovered += 1;
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    watchdog.arm();
    clock.advance(20_000);
    // 이 시점에 백엔드가 다시 떴다 — 옛 감시가 새 세대를 죽이면 안 된다.
    watchdog.arm();
    clock.advance(20_000);
    expect(recovered).toBe(0);

    clock.advance(10_000);
    expect(recovered).toBe(1);
  });

  test('준비 선언 없이 반복되면 연속 횟수가 올라간다 ★', () => {
    const clock = makeClock();
    const seen: number[] = [];
    const watchdog = createReadinessWatchdog({
      timeoutMs: 10_000,
      onTimeout: (consecutive) => {
        seen.push(consecutive);
        watchdog.arm(); // 부르는 쪽이 재기동하고 다시 무장한다
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    watchdog.arm();
    clock.advance(10_000);
    clock.advance(10_000);
    clock.advance(10_000);

    // 재기동은 실패의 결과지 성공의 증거가 아니다 — arm 이 횟수를 지우면 안 된다.
    expect(seen).toEqual([1, 2, 3]);
  });

  test('준비 선언이 오면 연속 횟수가 0 으로 돌아간다', () => {
    const clock = makeClock();
    const seen: number[] = [];
    const watchdog = createReadinessWatchdog({
      timeoutMs: 10_000,
      onTimeout: (consecutive) => seen.push(consecutive),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    watchdog.arm();
    clock.advance(10_000);
    watchdog.arm();
    watchdog.disarm(); // 이번엔 떴다
    watchdog.arm();
    clock.advance(10_000);

    expect(seen).toEqual([1, 1]);
  });

  test('복구를 부른 뒤 다시 무장할 수 있다', () => {
    const clock = makeClock();
    let recovered = 0;
    const watchdog = createReadinessWatchdog({
      timeoutMs: 30_000,
      onTimeout: () => {
        recovered += 1;
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    watchdog.arm();
    clock.advance(30_000);
    watchdog.arm();
    clock.advance(30_000);

    expect(recovered).toBe(2);
  });
});
