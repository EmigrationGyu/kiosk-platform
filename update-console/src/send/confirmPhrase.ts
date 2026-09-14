import type { HostKey } from '../types';

/**
 * 전체 배포의 마지막 관문 — 서버 이름을 그대로 쳐야 열린다.
 *
 * 버튼 하나로 수백 대에 나가는 경로는 없어야 한다. 서버 이름을 고른 이유: 운영자가 지금
 * 어느 서버에 로그인했는지 한 번 더 읽게 만들고, staging 에서 익힌 손이 production 에서
 * 그대로 눌리는 것을 막는다. 앞뒤 공백만 무시하고 대소문자는 그대로 본다.
 */
export const matchesConfirmPhrase = (input: string, host: HostKey): boolean =>
  input.trim() === host;
