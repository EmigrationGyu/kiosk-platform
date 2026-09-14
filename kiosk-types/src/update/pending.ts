const UPDATE_PENDING = 'UPDATE_PENDING';

/**
 * "업데이트 준비 중이라 받지 않았다" — 거절 사유.
 *
 * 포트 교체 503 과 **반드시 구별해야 한다**:
 *
 * - 이 사유 = 실행 **전에** 거절했다 → 확실히 아무 일도 없었다 → 재시도가 안전하다
 * - 포트 교체 = 보내고 응답만 못 받았다 → **결과 불명** → 자동 재시도하면 현금이 두 번 나갈 수 있다
 *
 * 그래서 사유를 접두어로 식별한다(`contractMismatchCause` 와 같은 방식). 둘을 뭉개면
 * 소비처가 안전한 재시도와 위험한 재시도를 가를 근거를 잃는다.
 */
export const updatePendingCause = (detail: string): string =>
  `${UPDATE_PENDING}: ${detail}`;

/** 받은 cause 가 업데이트 대기인지 — 조용히 재시도해도 되는 유일한 실패다. */
export const isUpdatePending = (cause: unknown): boolean =>
  typeof cause === 'string' && cause.startsWith(UPDATE_PENDING);
