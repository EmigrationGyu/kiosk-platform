/**
 * 계약 불일치 — 상대가 **이 이벤트 자체를 모른다**는 신호.
 *
 * 페이로드 드리프트는 zod 가 잡아 검증 에러로 돌려주지만, "이벤트를 아예 모르는" 경우는
 * 스키마 조회 실패나 핸들러 부재로 나타나 지금껏 일반 500 에 뭉개졌다. 그러면 상대가
 * 터진 것인지 계약이 갈린 것인지 구별할 수 없다.
 *
 * 원격 부분 업데이트에서 이 구별은 복구 방식을 가른다 — 전자는 재시도, 후자는 되감기다.
 * 그래서 별도 cause 로 승격해 로그와 프론트가 한눈에 알아보게 한다.
 * (같은 상황을 3b 의 계약 지문 로그가 "왜 갈렸는지" 쪽에서 설명한다.)
 */
export const CONTRACT_MISMATCH = 'E_CONTRACT_MISMATCH';

/** cause 문자열을 만든다. 어느 이벤트에서 갈렸는지가 진단의 핵심이라 detail 을 요구한다. */
export const contractMismatchCause = (detail: string): string =>
  `${CONTRACT_MISMATCH}: ${detail}`;

/** 받은 cause 가 계약 불일치인지. 소비처가 복구 경로를 가르는 데 쓴다. */
export const isContractMismatch = (cause: unknown): boolean =>
  typeof cause === 'string' && cause.startsWith(CONTRACT_MISMATCH);
