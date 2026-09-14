import type { TransitionCondition } from '@/shared/FSM/types';
import type { DispenserStatus } from '../utils/parseStatus';

// 공통 에러 판별 헬퍼

/**
 * 지금 새 명령을 받을 수 없는 상태인가.
 *
 * `executeAndPoll` 의 사전 검사가 거부하는 조건이자, 리셋 여진이 가라앉기를 기다리는
 * 조건이다. **두 곳이 같은 술어를 봐야** 한다 — 갈리면 "기다렸는데 그 다음 명령이 튕기는"
 * 어긋남이 생긴다(RS 직후 재무장이 정확히 그 사고였다).
 */
export const isCommandBlocked = (s: {
  commandNotExecutable: boolean;
  tokenJam: boolean;
  dispenseError: boolean;
  returnError: boolean;
}): boolean =>
  s.commandNotExecutable || s.tokenJam || s.dispenseError || s.returnError;

const hasDispensingError = (s: {
  tokenJam: boolean;
  dispenseError: boolean;
  tokenOverlap: boolean;
  commandNotExecutable: boolean;
}) => s.tokenJam || s.dispenseError || s.tokenOverlap || s.commandNotExecutable;

const hasRecyclingError = (s: {
  tokenJam: boolean;
  returnError: boolean;
  returnBoxFull: boolean;
  commandNotExecutable: boolean;
}) => s.tokenJam || s.returnError || s.returnBoxFull || s.commandNotExecutable;

// 토큰 발급
// isInProgress 판별 기준:
//   1. dispensing가 true면 모터 동작 중이므로 무조건 IN_PROGRESS
//   2. dispensing가 false여도 목표 센서 미도달이면 IN_PROGRESS (시작 전 과도 상태)

/** 토큰이 이송로 어딘가에 있었는지(모터 동작 or 센서 물림) — 직전 폴 판정용. */
const inTransport = (s: DispenserStatus | null | undefined): boolean =>
  !!s && (s.dispensing || s.tokenAtHopper || s.tokenAtMid || s.tokenAtGate);

/**
 * T1: 게이트까지 방출 — 손이 닿는 위치에 세운다. **이 전이가 `needsPrev` 의 이유다.**
 *
 * 단일 스냅샷으로는 두 개의 all-sensor-false 상태를 구분할 수 없다:
 *   (a) 방출 시작 전 과도상태 — 토큰이 아직 호퍼에 있어 이송로가 빔.
 *   (b) 성공 — 게이트에 섰던 토큰을 손님이 이미 가져가 이송로가 빔.
 * 그래서 직전 폴(prev)을 참조한다: 직전에 토큰이 이송로에 있었고(inTransport) 지금 비었으면 (b),
 * 처음부터 비어 있었으면 (a). 상태는 StateMachine 이 소유하고 이 전이는 무상태 순수 함수로 남는다.
 *
 * 완료 = 모터 정지 && ( 게이트에 대기 중 || 직전에 이송로에 있던 토큰이 빠져나감 ).
 * 두 종착 모두 "토큰이 물리적으로 손님 영역에 있음" = 성공. 이걸 스냅샷만으로 판정하면
 * 시작 직후의 빈 이송로를 성공으로 읽어 **방출한 적 없는데 성공**이 된다.
 */
export const dispenseTransition: TransitionCondition<DispenserStatus> = {
  needsPrev: true,
  isError: (s) => hasDispensingError(s) || s.tokenEmpty,
  isComplete: (s, prev) => {
    if (s.dispensing) return false;
    // 게이트 대기: 손님이 가져갈 위치에 서 있다.
    if (s.tokenAtGate) return true;
    // 이미 가져감: 직전 폴엔 이송로에 토큰이 있었고 지금 비었다.
    return inTransport(prev) && !s.tokenAtMid && !s.tokenAtHopper;
  },
  isInProgress: (s, prev) => {
    if (s.dispensing || s.tokenAtMid || s.tokenAtHopper) return true;
    // 시작 전 과도상태: 직전에도 이송로가 비었고 지금 게이트 미도달.
    return !s.tokenAtGate && !inTransport(prev);
  },
};

/**
 * P4·P6: 중간 대기 위치까지만 방출 — 손이 닿기 전에 세운다 — **중간에 세우는** 유일한 명령이라 완료 판정이 까다롭다.
 *
 * 완료는 센서 도달이 아니라 **모터 정지까지** 확인한다. 센서만 보면 토큰이 중간 센서를 건드리는
 * 순간 — 모터가 아직 도는데 — 완료가 나고, 그 위로 다음 명령(회수)이 들어가면 방출(앞)과
 * 회수(뒤)가 맞물려 토큰이 두 센서에 걸친 채 멈춘다. 이 정지는 `tokenJam` 을 세우지 않아
 * **어떤 에러 술어에도 안 걸리고** 폴 예산만 조용히 소진한다 — 실패로 끝나되 이유가 안 남는다.
 * (실측: 모터 회전 중 발사한 후속 명령 3/3 잼, 정지 후 발사 9/9 성공.)
 *
 * 방향을 안 가리는 `isMotorRunning` 을 쓰는 이유: 장비가 인입/배출 중 세우는 비트가 무엇인지는
 * 명령마다 다르고, 한쪽만 보면 다른 쪽에서 같은 사고가 되풀이된다.
 */
export const dispenseToMidTransition: TransitionCondition<DispenserStatus> = {
  isComplete: (s) => !isMotorRunning(s) && s.tokenAtMid,
  isError: (s) => hasDispensingError(s) || s.tokenEmpty,
  isInProgress: (s) => isMotorRunning(s) || !s.tokenAtMid,
};

/** 모터가 도는 중 — 방향 불문. 완료 판정은 반드시 이게 내려간 뒤여야 한다. */
const isMotorRunning = (s: {
  dispensing: boolean;
  collecting: boolean;
}): boolean => s.dispensing || s.collecting;

// 토큰 회수

/** T2: 게이트의 토큰을 반환함으로 회수 */
export const returnTokenTransition: TransitionCondition<DispenserStatus> = {
  isComplete: (s) =>
    !s.collecting && !s.tokenAtHopper && !s.tokenAtMid && !s.tokenAtGate,
  isError: (s) => hasRecyclingError(s),
  isInProgress: (s) =>
    s.collecting || s.tokenAtHopper || s.tokenAtMid || s.tokenAtGate,
};

/** T3: 게이트의 토큰을 호퍼로 되돌린다(재사용) */
export const collectToHopperTransition: TransitionCondition<DispenserStatus> = {
  isComplete: (s) =>
    !s.collecting && !s.tokenAtHopper && !s.tokenAtMid && !s.tokenAtGate,
  isError: (s) => hasRecyclingError(s),
  isInProgress: (s) =>
    s.collecting || s.tokenAtHopper || s.tokenAtMid || s.tokenAtGate,
};

// 리셋

/** Z0: 리셋 - 에러 플래그가 해소될 때까지 대기, 에러 판정은 타임아웃에 위임 */
export const resetTransition: TransitionCondition<DispenserStatus> = {
  isComplete: (s) =>
    !s.tokenJam &&
    !s.dispenseError &&
    !s.returnError &&
    !s.tokenOverlap &&
    !s.commandNotExecutable &&
    !s.dispensing &&
    !s.collecting,
  isError: () => false,
  isInProgress: (s) =>
    s.dispensing ||
    s.collecting ||
    s.tokenJam ||
    s.dispenseError ||
    s.returnError ||
    s.tokenOverlap ||
    s.commandNotExecutable,
};
