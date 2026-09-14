import { Subject } from 'rxjs';

/**
 * idle 경고 "계속 사용" 신호 채널. 오버레이 버튼 → 전역 idle 파이프라인의 `resume$`.
 *
 * 경고 중에는 ambient 활동(배경 탭 등)이 파이프라인에서 무시되므로, 경고를 해제하는 유일한 길은
 * 이 명시적 신호다. document 활동 리스너로는 못 지나가는 버튼 전용 경로.
 */
export const idleResume$ = new Subject<void>();

export const emitIdleResume = () => idleResume$.next();
