/**
 * 키오스크 세션 = "홈 이탈 ~ 완료/홈 복귀" 1회 게스트 상호작용.
 *
 * 웹 세션과 다르므로 자체 sessionId 를 발급하고, goHome(홈 복귀)마다 갱신한다.
 * 모든 이벤트에 sessionId 가 붙어야 게스트 단위 퍼널이 성립한다.
 *
 * completed 플래그: 성공 종착지(stage 5)에서 completeSession() 으로 표시 →
 * goHome 이 완료된 세션을 이탈(session_abandoned)로 오집계하지 않게 한다.
 */
let currentSessionId = newId();
let completed = false;

function newId(): string {
  return crypto.randomUUID();
}

export function getSessionId(): string {
  return currentSessionId;
}

/** 성공 종착지에서 호출(stage 5) — 이 세션은 이탈이 아니라 완료로 표시. */
export function completeSession(): void {
  completed = true;
}

export function isSessionCompleted(): boolean {
  return completed;
}

/** 홈 복귀(goHome) 시 호출 — 다음 게스트를 새 세션으로 분리하고 완료 플래그 초기화. */
export function resetSession(): void {
  currentSessionId = newId();
  completed = false;
}
