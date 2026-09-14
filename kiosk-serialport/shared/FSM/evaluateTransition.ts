import type { TransitionCondition, TransitionResult } from './types';

/**
 * 전이 조건에 상태를 대입하여 결과를 반환한다.
 * 평가 순서: ERROR → COMPLETE → IN_PROGRESS → UNEXPECTED
 *
 * `needsPrev: true`(HistoryTransition)면 직전 폴 상태 prev(첫 폴이면 null)를 주입하고,
 * 아니면(SnapshotTransition) 현재 상태만 넘긴다 — 스냅샷 전이는 prev 를 받을 시그니처조차 없다.
 */
export const evaluateTransition = <TStatus>(
  status: TStatus,
  condition: TransitionCondition<TStatus>,
  prev: TStatus | null = null,
): TransitionResult => {
  if (condition.needsPrev) {
    if (condition.isError(status, prev)) return 'ERROR';
    if (condition.isComplete(status, prev)) return 'COMPLETE';
    if (condition.isInProgress(status, prev)) return 'IN_PROGRESS';
    return 'UNEXPECTED';
  }
  if (condition.isError(status)) return 'ERROR';
  if (condition.isComplete(status)) return 'COMPLETE';
  if (condition.isInProgress(status)) return 'IN_PROGRESS';
  return 'UNEXPECTED';
};
