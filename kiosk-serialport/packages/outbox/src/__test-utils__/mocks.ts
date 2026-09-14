import type { OutboxMutationRow } from '../db';
import type {
  MutationExecutionResult,
  MutationExecutor,
} from '../scheduler/MutationExecutor';
import type { SchedulerTimer } from '../scheduler/OutboxScheduler';

// ── MockExecutor ──────────────────────────────────────────────────────

/**
 * 결정적 verdict 를 row.id 로 매핑해 반환하는 mock executor.
 * `setVerdict(id, verdict)` 로 행별로 결과를 박아두고,
 * 미설정 행은 `defaultVerdict` (기본 success).
 *
 * `kind: 'throw'` 는 executor 자체가 예외를 던지는 케이스를 시뮬레이션.
 */
export type MockVerdict =
  | { kind: 'success' }
  | { kind: 'transient_failure'; error: string }
  | { kind: 'permanent_failure'; error: string }
  | { kind: 'deferred'; reason: string }
  | { kind: 'throw'; error: string };

export class MockExecutor implements MutationExecutor {
  private verdicts = new Map<string, MockVerdict>();
  private defaultVerdict: MockVerdict = { kind: 'success' };
  public callLog: string[] = [];

  setVerdict(rowId: string, verdict: MockVerdict): void {
    this.verdicts.set(rowId, verdict);
  }

  setDefault(verdict: MockVerdict): void {
    this.defaultVerdict = verdict;
  }

  async execute(row: OutboxMutationRow): Promise<MutationExecutionResult> {
    this.callLog.push(row.id);
    const v = this.verdicts.get(row.id) ?? this.defaultVerdict;
    if (v.kind === 'throw') {
      throw new Error(v.error);
    }
    return v;
  }
}

// ── MockTimer ─────────────────────────────────────────────────────────

/**
 * 시간 제어 가능한 mock 타이머. 실제 setTimeout 호출 안 함.
 * `runNext()` 로 가장 오래된 보류 콜백을 수동 실행.
 */
export class MockTimer implements SchedulerTimer {
  private handles: Array<{ id: number; fn: () => void; ms: number } | null> =
    [];
  private nextId = 0;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.handles.push({ id, fn, ms });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    const id = handle as number;
    const idx = this.handles.findIndex((h) => h !== null && h.id === id);
    if (idx >= 0) this.handles[idx] = null;
  };

  /** 가장 오래된 pending 콜백 1개 실행. */
  async runNext(): Promise<void> {
    const idx = this.handles.findIndex((h) => h !== null);
    if (idx < 0) return;
    const cb = this.handles[idx];
    if (!cb) return;
    this.handles[idx] = null;
    await cb.fn();
  }

  pendingCount(): number {
    return this.handles.filter((h) => h !== null).length;
  }

  /** 마지막으로 등록된 setTimeout 의 ms. */
  lastDelayMs(): number | undefined {
    for (let i = this.handles.length - 1; i >= 0; i--) {
      const h = this.handles[i];
      if (h !== null) return h?.ms;
    }
    return undefined;
  }
}
