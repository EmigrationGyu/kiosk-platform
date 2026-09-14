/**
 * ENSURE_ASSETS 왕복 타임아웃.
 * 백엔드 응답은 존재확인+백그라운드 킥의 즉답(네트워크 비대기)이라, 이 값은 다운로드가
 * 아니라 "백엔드 자체가 죽어있는 경우"의 가드일 뿐이다 — 부팅 tolerant 위상 전용.
 */
export const IME_ENSURE_TIMEOUT_MS = 3_000;
