/**
 * 던져진 값에서 원인 문자열을 뽑는다. 트랜스포트는 `{ cause, code }` 나 문자열(zod
 * 검증 실패)로, 그 외에는 `Error` 로 던진다 — 세 모양을 여기서만 벗긴다.
 */
export const extractCause = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.cause === 'string') return record.cause;
    if (typeof record.name === 'string' && record.name.length > 0) {
      // MutexPurgedError 처럼 name 을 채널 사유로 고정한 에러.
      if (record.name !== 'Error') return record.name;
    }
    if (typeof record.message === 'string') return record.message;
  }
  return '';
};
