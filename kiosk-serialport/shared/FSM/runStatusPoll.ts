import type { StateMachine } from './StateMachine';
import type { TransitionCondition } from './types';

/**
 * 폴링이 도달한 종착 상태. 각 호출자는 settle() 에서 이 합집합을 자기 도메인 결과나 에러로 매핑한다.
 * COMPLETE/ERROR/UNEXPECTED 는 FSM 전이 판정(status = 판정을 유발한 마지막 폴), ABORTED 는
 * signal.aborted 감지, TIMEOUT 은 폴 예산 소진이다(lastStatus 는 직전/마지막 폴, 없으면 null).
 */
export type PollOutcome<TStatus> =
  | { kind: 'COMPLETE'; status: TStatus }
  | { kind: 'ERROR'; status: TStatus }
  | { kind: 'UNEXPECTED'; status: TStatus }
  | { kind: 'ABORTED'; lastStatus: TStatus | null }
  | { kind: 'TIMEOUT'; lastStatus: TStatus | null };

/**
 * 폴링 상한. 두 단위 중 **정확히 하나만** 고른다 — 공존시키면 "어느 쪽이 먼저 터졌나"가 로그에만 남고,
 * 이 폴링을 감싸는 바깥 타임아웃은 어느 값에 맞춰야 할지 알 수 없게 된다.
 *
 * - `maxPollCount` — 폴 **횟수** 상한. 모터 동작처럼 "몇 번 확인하면 끝나는" 연산용. `intervalMs` 를
 *   곱해 벽시계로 환산하지 말 것: 한 폴의 실제 비용은 `intervalMs + getStatus 왕복` 이라 환산값은 항상
 *   실제보다 짧다. POSITIVE_INFINITY 를 주면 상한을 끄고 종료를 COMPLETE/ERROR/ABORT/onPoll-throw 에 위임한다.
 * - `budgetMs` — **벽시계** 예산. 바깥 타임아웃과 단위를 맞춰야 하는 곳에서 쓴다(마지막 폴의 왕복만큼은 넘길 수 있다).
 */
export type PollBudget =
  | { maxPollCount: number; budgetMs?: never }
  | { budgetMs: number; maxPollCount?: never };

/** 예산의 종류를 루프 밖에서 술어 하나로 접는다 — 루프는 어느 단위인지 모른다. */
const withinBudget = (budget: PollBudget): ((pollIndex: number) => boolean) => {
  if (budget.budgetMs !== undefined) {
    const deadline = Date.now() + budget.budgetMs;
    return () => Date.now() < deadline;
  }
  const { maxPollCount } = budget;
  return (pollIndex) => pollIndex < maxPollCount;
};

interface PollSpecBase<TStatus, R> {
  fsm: StateMachine<TStatus>;
  /** 종료 조건 (COMPLETE/ERROR/IN_PROGRESS/UNEXPECTED 판정). */
  transition: TransitionCondition<TStatus>;
  /** 매 틱 디바이스 상태를 조회한다. */
  getStatus: () => Promise<TStatus>;
  intervalMs: number;
  /** 진행 중인 작업을 중단시키는 신호. aborted면 다음 틱에 ABORTED로 종료. */
  signal?: AbortSignal;
  /**
   * getStatus 실패 처리. 'skip'이면 그 틱을 건너뛰고 다음 폴로(IN_PROGRESS처럼)
   * 진행, 'throw'(기본)면 즉시 전파. 'skip'도 폴 예산은 그대로 소진한다.
   */
  onStatusError?: 'throw' | 'skip';
  /**
   * feed 직전에 매 폴 상태로 호출되는 부수효과 훅(세션 갱신, idle 추적 등).
   * 여기서 throw하면 그대로 전파되어 폴링이 종료된다(예: idle 타임아웃).
   */
  onPoll?: (status: TStatus, pollIndex: number) => void;
  /** 종착 상태를 호출자의 결과/에러로 매핑한다. */
  settle: (outcome: PollOutcome<TStatus>) => R | Promise<R>;
}

export type PollSpec<TStatus, R> = PollSpecBase<TStatus, R> & PollBudget;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 커맨드 송신 이후의 "FSM 폴링 루프"를 단일 구현으로 묶는다. FSM 라이프사이클(ERROR 복구 → start →
 * feed → EXECUTING 마감)을 전적으로 소유하므로 호출자는 fsm.state/reset/forceError/lastStatus 를 직접
 * 만지지 않고, 종착 상태 매핑만 settle 로 주입한다.
 *
 * 커맨드 송신/사전검사와 자원 정리(식별기 비활성화 등)는 호출자 책임이다 — 이 함수는 start() 부터
 * 종착 매핑까지만 담당한다.
 */
export async function runStatusPoll<TStatus, R>(
  spec: PollSpec<TStatus, R>,
): Promise<R> {
  const {
    fsm,
    transition,
    getStatus,
    intervalMs,
    signal,
    onStatusError = 'throw',
    onPoll,
    settle,
  } = spec;

  // 예산 시계는 폴링 시작과 함께 출발한다(술어를 만드는 시점 = deadline 기산점).
  const hasBudget = withinBudget(spec);

  fsm.beginOrRecover(transition);

  try {
    for (let i = 0; hasBudget(i); i++) {
      await delay(intervalMs);

      if (signal?.aborted) {
        return settle({ kind: 'ABORTED', lastStatus: fsm.lastStatus });
      }

      let status: TStatus;
      try {
        status = await getStatus();
      } catch (e) {
        if (onStatusError === 'skip') continue;
        throw e;
      }

      onPoll?.(status, i);

      const result = fsm.feed(status);
      switch (result) {
        case 'COMPLETE':
          return settle({ kind: 'COMPLETE', status });
        case 'ERROR':
          return settle({ kind: 'ERROR', status });
        case 'UNEXPECTED':
          return settle({ kind: 'UNEXPECTED', status });
        case 'IN_PROGRESS':
          break;
        default:
          throw new Error(`Invalid transition result: ${result}`);
      }
    }

    return settle({ kind: 'TIMEOUT', lastStatus: fsm.lastStatus });
  } finally {
    fsm.concludeIfRunning();
  }
}
