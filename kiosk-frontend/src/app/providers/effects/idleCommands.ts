import { ABANDON_REASON, type AbandonReason } from '@/shared/analytics';
import type { IdleCommand } from './idleStream';

/**
 * 커맨드 → 효과 매핑을 **효과 주입 순수 함수**로 격리(shell 의 부수효과를 spy 로 박제하기 위함).
 * 순수 시간축(createIdleStream)이 낸 커맨드를 실제 부수효과로 옮기는 유일한 지점.
 */
export interface IdleCommandDeps {
  beginWarning: (deadline: number) => void;
  dismissWarning: () => void;
  dismissGlobalUI: () => void;
  goHome: (reason: AbandonReason) => void;
  now: () => number;
  graceMs: number;
}

export const makeIdleCommandRunner =
  (deps: IdleCommandDeps) =>
  (cmd: IdleCommand): void => {
    switch (cmd) {
      case 'warn':
        deps.beginWarning(deps.now() + deps.graceMs);
        return;
      case 'fire':
        // 순서 불변식: 경고 해제(overlay 내림) → 밑 오버레이 수거 → 홈.
        // goHome 이 막혀도(in-flight) 경고는 먼저 걷힌다.
        deps.dismissWarning();
        deps.dismissGlobalUI();
        deps.goHome(ABANDON_REASON.IDLE);
        return;
      case 'counting':
        deps.dismissWarning();
        return;
      default:
        return cmd satisfies never; // 닫힌 집합 — 새 커맨드 누락 시 컴파일 에러
    }
  };
