export type TransitionResult =
  | 'COMPLETE'
  | 'ERROR'
  | 'IN_PROGRESS'
  | 'UNEXPECTED';

/**
 * 현재 스냅샷만으로 판정 가능한 전이(대부분). predicate 는 현재 상태만 받는다 — prev 를
 * 읽을 방법이 시그니처에 아예 없으므로, 이력에 의존하려면 HistoryTransition 으로 넘어가야 한다.
 */
export interface SnapshotTransition<TStatus> {
  needsPrev?: false;
  isComplete: (status: TStatus) => boolean;
  isError: (status: TStatus) => boolean;
  isInProgress: (status: TStatus) => boolean;
}

/**
 * 직전 폴 상태(prev)가 있어야 판정 가능한 전이. 단일 스냅샷으로 구분 불가능한 종착
 * (예: 카드가 배출돼 이송로가 비었는지 vs 아직 시작 전이라 비었는지)을 prev 로 가른다.
 * 상태는 StateMachine 이 `_lastStatus` 로 소유하고 evaluateTransition 이 주입하므로,
 * 전이 함수 자신은 무상태 순수 함수로 남는다. `needsPrev: true` 는 이 의존을 타입에 못박아
 * evaluateTransition 이 prev 를 넘기도록 강제하고, 코드베이스에서 grep 가능하게 만든다.
 */
export interface HistoryTransition<TStatus> {
  needsPrev: true;
  isComplete: (status: TStatus, prev: TStatus | null) => boolean;
  isError: (status: TStatus, prev: TStatus | null) => boolean;
  isInProgress: (status: TStatus, prev: TStatus | null) => boolean;
}

/**
 * 전이 판정 조건. prev 미사용이면 SnapshotTransition(기본), prev 의존이면 HistoryTransition.
 * predicate 가 prev 를 읽는 순간 2-인자 시그니처가 되어 Snapshot 에 안 맞으므로, 컴파일러가
 * `needsPrev: true` 선언을 강제한다 = "이 전이는 이력이 필요하다"가 타입으로 못박힌다.
 */
export type TransitionCondition<TStatus> =
  | SnapshotTransition<TStatus>
  | HistoryTransition<TStatus>;
