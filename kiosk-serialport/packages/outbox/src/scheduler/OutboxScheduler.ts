import { Logger } from '@/shared/Logger';
import type { OutboxMutationRow } from '../db';
import type { OutboxService } from '../service/OutboxService';
import type {
  MutationExecutionResult,
  MutationExecutor,
} from './MutationExecutor';
import { UnconfiguredExecutor } from './MutationExecutor';

/** 타이머 주입 인터페이스 — 테스트에서 mock 으로 교체해 시간을 제어한다. */
export type SchedulerTimer = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const DEFAULT_TIMER: SchedulerTimer = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export type OutboxSchedulerDeps = {
  service: OutboxService;
  executor?: MutationExecutor;
  /** 픽업 주기 (ms). 기본 10_000 (10초). */
  intervalMs?: number;
  /** 한 사이클에 동시 실행할 최대 mutation 수. 기본 4. */
  concurrency?: number;
  /** 테스트용 타이머 주입. 기본은 setTimeout/clearTimeout. */
  timer?: SchedulerTimer;
};

/** 한 행이 이번 사이클에 어떻게 끝났는가. `threw` 는 executor 자체가 터진 경우. */
type ProcessOutcome = MutationExecutionResult['kind'] | 'threw';

/**
 * 주기적으로 `pickReady` 로 ready 행을 뽑고 MutationExecutor 로 실행한 뒤 verdict 에 따라
 * markSuccess / markFailure / markDead / markDeferred 를 디스패치한다.
 * 외부에서는 start / stop / drainNow 만 쓴다.
 */
export class OutboxScheduler {
  private service: OutboxService;
  private executor: MutationExecutor;
  private intervalMs: number;
  private concurrency: number;
  private timer: SchedulerTimer;
  private logger = Logger.getInstance();

  private running = false;
  private timerHandle: unknown = null;

  constructor(deps: OutboxSchedulerDeps) {
    this.service = deps.service;
    this.executor = deps.executor ?? new UnconfiguredExecutor();
    this.intervalMs = deps.intervalMs ?? 10_000;
    this.concurrency = deps.concurrency ?? 4;
    this.timer = deps.timer ?? DEFAULT_TIMER;
  }

  /**
   * 타이머 시작. 이미 running 이면 no-op. 첫 tick 전에 resetInFlight 를 한 번 수행한다(부팅 복구).
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.service.resetInFlight();

    this.scheduleNextTick();
  }

  /** 타이머 정지. 보류된 timer 를 cancel 하고 다음 tick 을 예약하지 않는다(진행 중인 처리는 끝까지). */
  stop(): void {
    this.running = false;
    if (this.timerHandle !== null) {
      this.timer.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /**
   * 즉시 1회 픽업 — DRAIN 엔드포인트, 부팅 접촉, 네트워크 복구 hook 이 호출한다.
   *
   * **실행은 기다리지 않는다.** 원격 왕복까지 붙들면 이 응답이 그만큼 늦고, 그동안 백엔드 눈에는 IPC
   * in-flight 라 업데이트 적용이 정숙을 기다리며 밀린다. 반환값은 픽업된 행 개수다.
   */
  async drainNow(): Promise<number> {
    const rows = await this._pick();
    if (rows.length === 0) return 0;

    // 배경으로 보내는 유일한 지점이라 여기서만 잡는다 — 안 잡으면 unhandled rejection.
    this._runBatch(rows).catch((e) =>
      this.logger.error('[OutboxScheduler] 배경 배치 실패:', e),
    );

    return rows.length;
  }

  // 내부

  /** 타이머 사이클은 실행까지 기다린다 — 그래야 사이클이 겹쳐 쌓이지 않는다. */
  private async _tick(): Promise<number> {
    const rows = await this._pick();
    if (rows.length === 0) return 0;

    await this._runBatch(rows);
    return rows.length;
  }

  private async _pick(): Promise<OutboxMutationRow[]> {
    // 픽업 직전에 기한을 본다 — 만료된 행이 한 번 더 나가는 창을 남기지 않는다.
    const expired = await this.service.expireOverdue();
    if (expired > 0) {
      this.logger.info('[OutboxScheduler] 기한 만료', {
        unmasked: { expired },
      });
    }

    return this.service.pickReady(this.concurrency);
  }

  private async _runBatch(rows: OutboxMutationRow[]): Promise<void> {
    const outcomes = await Promise.all(
      rows.map((row) => this._processOne(row)),
    );

    // 보류는 행마다 다른 사실이 아니라 프로세스 전체의 사실이라, 행당 한 줄이 아니라
    // 사이클당 한 줄로 남긴다 — 오프라인이 길어지면 행당 로그가 파일을 덮는다.
    const deferred = outcomes.filter((o) => o === 'deferred').length;
    if (deferred > 0) {
      this.logger.info('[OutboxScheduler] 보류 — 아직 물어보지 못했다', {
        unmasked: { deferred },
      });
    }
  }

  private async _processOne(row: OutboxMutationRow): Promise<ProcessOutcome> {
    let verdict: MutationExecutionResult;

    // try 는 executor 호출만 감싼다. 디스패치까지 감싸면 우리 코드의 버그가
    // "일시 실패" 로 둔갑해 조용히 시도를 까먹는다 (로그 호출 오타 한 번으로 겪었다).
    try {
      verdict = await this.executor.execute(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // executor 가 throw 한 것은 우리 코드가 돌다 터진 것이다 — 못 물어본 것과 다르다.
      // transient 로 세고, 영구 버그면 백오프로 돌다 기한(expiresAt)이 EXPIRED 로 닫는다.
      await this.service.markFailure(row.id, `executor threw: ${msg}`);
      return 'threw';
    }

    switch (verdict.kind) {
      case 'success':
        await this.service.markSuccess(row.id);
        return 'success';
      case 'transient_failure':
        await this.service.markFailure(row.id, verdict.error);
        return 'transient_failure';
      case 'permanent_failure':
        await this.service.markDead(row.id, verdict.error);
        return 'permanent_failure';
      case 'deferred':
        // 묻지 못했다 — 시도로 세지 않는다. 사유는 행이 아니라 로그가 진다.
        await this.service.markDeferred(row.id);
        return 'deferred';
      default: {
        // verdict 가 늘면 여기서 컴파일 에러가 난다 — 조용히 안 처리되는 갈래를 막는다.
        const unhandled: never = verdict;
        return unhandled;
      }
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timerHandle = this.timer.setTimeout(async () => {
      this.timerHandle = null;
      try {
        await this._tick();
      } catch (e) {
        this.logger.error('[OutboxScheduler] tick failed:', e);
      } finally {
        this.scheduleNextTick();
      }
    }, this.intervalMs);
  }
}
