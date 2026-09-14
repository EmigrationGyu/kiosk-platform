import { SERIALPORT_PROCESS, type SerialportProcess } from 'kiosk-types';

/**
 * 서브프로세스 수명 정책.
 *
 * 기본은 lazy — 부팅 때 띄우지 않고 첫 request 시점에 올리며, 장기 무활동이면 reaper 가
 * 내린다. 무상태 서브프로세스라 껐다 켜도 spawn 시간 외 문제가 없음이 보장되어 있다
 * (요청 시 재탐지 / PORT_ASSIGNED 복구). 그 전제를 깨는 프로세스는 PERSISTENT 로 뺀다.
 *
 * EAGER 는 그 예외 자리다 — 첫 요청까지 기다릴 수 없는 프로세스를 여기 넣는다. 전형적인
 * 후보는 **부팅 시점에 이미 밀린 일을 들고 있는** 프로세스다: lazy 로 두면 다음 요청이
 * 올 때까지 아무도 그 큐를 돌리지 않아, 밤새 쌓인 것이 아침까지 안 나간다.
 *
 * 비어 있는 것이 기본이다 — 여기 넣는 것은 "부팅을 그만큼 느리게 해도 좋다"는 선언이다.
 */
export const EAGER_PROCESSES: ReadonlySet<SerialportProcess> = new Set([
  SERIALPORT_PROCESS.OUTBOX,
]);

export const isLazy = (process: SerialportProcess): boolean =>
  !EAGER_PROCESSES.has(process);

/** 관리 대상 = serialport 닫힌 집합 전체. 새 디바이스는 gen 이 그 집합에 넣으면 자동 편입된다. */
export const MANAGED_PROCESSES: readonly SerialportProcess[] =
  Object.values(SERIALPORT_PROCESS);

/**
 * 자기 타이머로 일하는 프로세스 — **IPC 무활동이 무활동을 뜻하지 않는다.** reaper 가 내리면
 * 겉보기엔 조용하던 진행이 함께 멈춘다.
 *
 * EAGER 와는 다른 축이다: eager 는 "언제 띄우나", persistent 는 "거둘 것인가".
 * 둘을 한 집합으로 합치면 "부팅부터 띄우되 거둬도 되는" 프로세스를 표현할 수 없다.
 */
export const PERSISTENT_PROCESSES: ReadonlySet<SerialportProcess> = new Set([
  SERIALPORT_PROCESS.OUTBOX,
]);

export const isPersistent = (process: SerialportProcess): boolean =>
  PERSISTENT_PROCESSES.has(process);

/** 이 시간 이상 in-flight 0 인 채로 방치된 서브프로세스는 reaper 가 종료한다. */
export const IDLE_SHUTDOWN_MS = 5 * 60_000;
/** reaper 폴링 주기. */
export const IDLE_REAP_INTERVAL_MS = 30_000;
