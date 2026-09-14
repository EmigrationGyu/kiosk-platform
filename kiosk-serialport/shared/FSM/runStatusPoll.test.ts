import { beforeAll, describe, expect, it } from 'bun:test';
import { Logger } from '@/shared/Logger';
import { runStatusPoll } from './runStatusPoll';
import { StateMachine } from './StateMachine';
import type { TransitionCondition } from './types';

// StateMachine 생성자가 Logger.getInstance()를 호출하므로 최초 1회 tag 초기화가 필요하다.
beforeAll(() => {
  try {
    Logger.getInstance('test');
  } catch {
    // 다른 테스트가 이미 초기화한 경우 무시
  }
});

/** status = 진행 카운터(number). 3 이상이면 완료, 음수면 에러. */
const transition: TransitionCondition<number> = {
  isComplete: (s) => s >= 3,
  isError: (s) => s < 0,
  isInProgress: (s) => s >= 0 && s < 3,
};

/** 호출할 때마다 미리 정한 시퀀스를 차례로 반환하는 가짜 getStatus. */
const sequence = (values: number[]): (() => Promise<number>) => {
  let i = 0;
  return async () => values[Math.min(i++, values.length - 1)]!;
};

const FAST = { intervalMs: 1, maxPollCount: 10 };

class DomainError extends Error {}

describe('runStatusPoll', () => {
  it('COMPLETE를 settle 반환값으로 매핑하고 FSM을 IDLE로 마감한다', async () => {
    const fsm = new StateMachine<number>('[test]');
    const result = await runStatusPoll({
      ...FAST,
      fsm,
      transition,
      getStatus: sequence([1, 2, 3]),
      settle: (o) => (o.kind === 'COMPLETE' ? o.status : -1),
    });
    expect(result).toBe(3);
    expect(fsm.state).toBe('IDLE');
  });

  it('ERROR를 settle에서 throw로 변환할 수 있다 (리치 에러 경로)', async () => {
    const fsm = new StateMachine<number>('[test]');
    const run = runStatusPoll({
      ...FAST,
      fsm,
      transition,
      getStatus: sequence([1, -1]),
      settle: (o) => {
        if (o.kind === 'ERROR') throw new DomainError('device error');
        return 'ok';
      },
    });
    await expect(run).rejects.toBeInstanceOf(DomainError);
    expect(fsm.state).toBe('ERROR');
  });

  it('TIMEOUT 시 lastStatus를 실어 settle하고 EXECUTING을 ERROR로 마감한다', async () => {
    const fsm = new StateMachine<number>('[test]');
    const result = await runStatusPoll({
      fsm,
      transition,
      getStatus: sequence([1, 1, 1]),
      intervalMs: 1,
      maxPollCount: 3,
      settle: (o) =>
        o.kind === 'TIMEOUT' ? `timeout:${o.lastStatus}` : 'other',
    });
    expect(result).toBe('timeout:1');
    expect(fsm.state).toBe('ERROR');
  });

  it('signal.aborted면 feed 없이 ABORTED로 종료한다', async () => {
    const fsm = new StateMachine<number>('[test]');
    const controller = new AbortController();
    controller.abort();
    const result = await runStatusPoll({
      ...FAST,
      fsm,
      transition,
      signal: controller.signal,
      getStatus: sequence([1, 2, 3]),
      settle: (o) => o.kind,
    });
    expect(result).toBe('ABORTED');
    expect(fsm.state).toBe('ERROR'); // EXECUTING으로 진입했다가 마감됨
  });

  it("onStatusError: 'skip'이면 getStatus 실패 틱을 건너뛰고 계속한다", async () => {
    const fsm = new StateMachine<number>('[test]');
    let call = 0;
    const result = await runStatusPoll({
      ...FAST,
      fsm,
      transition,
      onStatusError: 'skip',
      getStatus: async () => {
        call++;
        if (call === 1) throw new Error('transient');
        return call >= 4 ? 3 : 1; // 첫 호출 throw → 이후 1,1 → 완료
      },
      settle: (o) => (o.kind === 'COMPLETE' ? o.status : -1),
    });
    expect(result).toBe(3);
    expect(call).toBeGreaterThanOrEqual(4);
  });

  it('onStatusError 기본값은 getStatus 에러를 전파하고 EXECUTING을 마감한다', async () => {
    const fsm = new StateMachine<number>('[test]');
    const run = runStatusPoll({
      ...FAST,
      fsm,
      transition,
      getStatus: async () => {
        throw new Error('hard fail');
      },
      settle: () => 'unreachable',
    });
    await expect(run).rejects.toThrow('hard fail');
    expect(fsm.state).toBe('ERROR');
  });

  it('onPoll에서 throw하면 전파되고 FSM이 마감된다 (idle 타임아웃 모사)', async () => {
    const fsm = new StateMachine<number>('[test]');
    const run = runStatusPoll({
      ...FAST,
      fsm,
      transition,
      getStatus: sequence([1, 1, 1]),
      onPoll: (_s, i) => {
        if (i === 1) throw new DomainError('idle timeout');
      },
      settle: () => 'unreachable',
    });
    await expect(run).rejects.toBeInstanceOf(DomainError);
    expect(fsm.state).toBe('ERROR');
  });

  it('budgetMs는 벽시계로 마감한다 — 폴 비용이 intervalMs보다 커도 예산을 넘기지 않는다', async () => {
    const fsm = new StateMachine<number>('[test]');
    let polls = 0;
    const startedAt = Date.now();
    const result = await runStatusPoll({
      fsm,
      transition,
      // 한 폴의 실제 비용 = intervalMs(5) + getStatus 왕복(15) = 20ms.
      // 횟수 예산이었다면 "예산/interval = 12회"로 오판했을 구간이다.
      getStatus: async () => {
        polls++;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return 1;
      },
      intervalMs: 5,
      budgetMs: 60,
      settle: (o) => o.kind,
    });
    expect(result).toBe('TIMEOUT');
    // 벽시계 마감이므로 폴 수는 예산/intervalMs(=12)가 아니라 예산/실제폴비용(≈3)에 가깝다.
    expect(polls).toBeLessThan(6);
    expect(Date.now() - startedAt).toBeLessThan(150);
  });

  it('budgetMs 예산이라도 종착 상태가 먼저면 그대로 COMPLETE로 끝난다', async () => {
    const fsm = new StateMachine<number>('[test]');
    const result = await runStatusPoll({
      fsm,
      transition,
      getStatus: sequence([1, 2, 3]),
      intervalMs: 1,
      budgetMs: 5_000,
      settle: (o) => (o.kind === 'COMPLETE' ? o.status : -1),
    });
    expect(result).toBe(3);
    expect(fsm.state).toBe('IDLE');
  });

  it('직전 작업이 ERROR로 끝나도 다음 실행을 자동 복구한다 (beginOrRecover)', async () => {
    const fsm = new StateMachine<number>('[test]');
    // 1차: 타임아웃으로 ERROR 마감
    await runStatusPoll({
      fsm,
      transition,
      getStatus: sequence([1]),
      intervalMs: 1,
      maxPollCount: 2,
      settle: () => 'timed-out',
    });
    expect(fsm.state).toBe('ERROR');

    // 2차: 별도 reset 없이 바로 재실행 → 정상 완료
    const result = await runStatusPoll({
      ...FAST,
      fsm,
      transition,
      getStatus: sequence([2, 3]),
      settle: (o) => (o.kind === 'COMPLETE' ? o.status : -1),
    });
    expect(result).toBe(3);
    expect(fsm.state).toBe('IDLE');
  });
});
