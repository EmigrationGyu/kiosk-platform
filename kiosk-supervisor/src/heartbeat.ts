// biome-ignore-all lint/suspicious/noConsole: stdout 이 부모로의 heartbeat 전송로.
/**
 * 자식 → 부모 heartbeat 송신 (outbound). 부모는 자식 stdout 의 `@@HB@@` 접두 라인을
 * heartbeat 로 인식한다. loader(→bootstrap), daemon(→loader) 둘 다 사용.
 *
 * 접두만 보면 충분하지만, 페이로드(버전/uptime)도 같이 실어 추후 원격 진단에 재사용.
 */

import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_LINE_PREFIX } from './constants';

/** heartbeat 송신을 시작하고, 중지 함수를 반환한다. */
export function startHeartbeat(getVersion: () => string): () => void {
  const startedAt = Date.now();

  const emit = () => {
    const payload = {
      type: 'alive',
      version: getVersion(),
      uptimeMs: Date.now() - startedAt,
    };
    // console.log 가 한 줄 + \n 을 stdout 에 기록 → 부모의 라인 파서가 수신.
    console.log(`${HEARTBEAT_LINE_PREFIX}${JSON.stringify(payload)}`);
  };

  emit(); // 즉시 첫 비트 — 부모 기동 게이트를 빨리 통과시킴
  const timer = setInterval(emit, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
