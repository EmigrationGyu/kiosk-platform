import type { ManifestBody } from '../api';

/**
 * 예약 실행자 — 콘솔이 아는 유일한 표면.
 *
 * 실행자가 서버(PMS 뮤테이션)일지 람다(Function URL)일지는 아직 정하지 않았다. 어느 쪽이든
 * 이 인터페이스 하나만 구현하면 화면은 바뀌지 않는다. 브라우저는 예약 시각에 살아 있지
 * 않으므로 실행은 반드시 밖에서 한다 — 콘솔은 걸고, 보고, 취소할 뿐이다.
 *
 * 예약 시각은 **지시가 도착하는 시각**이다. 적용은 각 키오스크가 홈 화면에서 한가할 때 한다.
 */
export type ScheduledJob = {
  id: string;
  kind: 'apply' | 'rollback';
  /** ISO 8601. 표시는 KST. */
  runAt: string;
  /** 예약 시점에 고정된 대상 — 그룹이 생기면 실행 시점 펼치기로 바뀐다. */
  kioskIds: readonly string[];
  manifest: ManifestBody | null;
  createdBy: string;
};

export type ScheduleRequest = Omit<ScheduledJob, 'id' | 'createdBy'>;

export type Scheduler = {
  list(): Promise<ScheduledJob[]>;
  create(request: ScheduleRequest): Promise<ScheduledJob>;
  cancel(id: string): Promise<void>;
};

/** 아직 실행자가 없다 — 화면은 이 값으로 "미배선"을 안다. 붙이면 이 상수만 바뀐다. */
export const scheduler: Scheduler | null = null;
