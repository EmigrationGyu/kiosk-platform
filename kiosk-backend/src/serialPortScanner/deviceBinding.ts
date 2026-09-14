import type { DetectionResult } from './types';

/**
 * 디바이스 바인딩 복구의 순수 결정 코어.
 *
 * lease(과거 탐지로 확정된 포트 소유권)는 서브프로세스 수명과 독립이다 — idle reaper 가
 * 프로세스를 죽여도 물리 배선이 바뀌는 건 아니다. 따라서 재스폰 복구의 기본 동작은
 * 재탐지(스캔 ping)가 아니라 leased port 로의 재바인딩(PORT_ASSIGNED 재발급)이고,
 * 포트를 여는 파괴적 재스캔은 최후 수단이다.
 *
 * 효과(IPC·스캔·대기)는 SerialPortScanner 가 해석하고, 여기는 "다음에 뭘 시도할지"만
 * 결정한다. (dispensePipeline 과 같은 이유 — 하드웨어 결정 로직은 순수 함수로 박제)
 */

/** 스캐너가 한 디바이스에 대해 아는 것 — 복구 결정의 입력. */
export type DeviceBinding =
  | { kind: 'leased'; lease: DetectionResult }
  | { kind: 'unleased'; scanInFlight: boolean };

/** 복구 한 스텝 — 닫힌 집합. */
export type RecoveryStep =
  | { kind: 'rebind'; lease: DetectionResult }
  | { kind: 'await-scan' }
  | { kind: 'rescan' };

/**
 * 한 recovery 런 안에서 이미 시도한 것들. 같은 스텝의 무한 반복을 막는다:
 * - rebind 는 포트당 1회 (실패로 lease 가 소거된 포트에 재도전하지 않음 —
 *   단, 경쟁 스캔이 **다른** 포트로 새 lease 를 만들면 그 포트로는 다시 허용)
 * - await-scan / rescan 은 런당 1회
 */
export type RecoveryHistory = {
  rebindAttemptedPorts: ReadonlySet<string>;
  awaitedScan: boolean;
  rescanned: boolean;
};

export const emptyHistory = (): RecoveryHistory => ({
  rebindAttemptedPorts: new Set(),
  awaitedScan: false,
  rescanned: false,
});

/**
 * 다음 복구 스텝을 결정한다. null = 시도할 것이 남지 않음(단념).
 *
 * 우선순위: rebind(비파괴, lease 활용) → await-scan(진행 중 탐지에 편승)
 * → rescan(파괴적 최후 수단). 각 스텝은 history 로 반복이 차단되므로,
 * 어떤 binding 시퀀스가 주어져도 유한 스텝 내에 종료한다.
 */
export const decideNextStep = (
  binding: DeviceBinding,
  history: RecoveryHistory,
): RecoveryStep | null => {
  if (
    binding.kind === 'leased' &&
    !history.rebindAttemptedPorts.has(binding.lease.portPath)
  ) {
    return { kind: 'rebind', lease: binding.lease };
  }
  if (
    binding.kind === 'unleased' &&
    binding.scanInFlight &&
    !history.awaitedScan
  ) {
    return { kind: 'await-scan' };
  }
  if (!history.rescanned) {
    return { kind: 'rescan' };
  }
  return null;
};

/** 스텝 시도를 history 에 기록한 새 history 를 돌려준다. */
export const recordStep = (
  history: RecoveryHistory,
  step: RecoveryStep,
): RecoveryHistory =>
  step.kind === 'rebind'
    ? {
        ...history,
        rebindAttemptedPorts: new Set([
          ...history.rebindAttemptedPorts,
          step.lease.portPath,
        ]),
      }
    : step.kind === 'await-scan'
      ? { ...history, awaitedScan: true }
      : { ...history, rescanned: true };
