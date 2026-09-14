import { Logger } from '@/shared/logger/Logger';

/**
 * 계측 싱크 — **no-op 어댑터**.
 *
 * 원본은 제품 분석 SDK 로 나갔다. 여기선 전송만 걷어내고 호출 표면은 그대로 둔다:
 * 중앙 이음새(`A11yNode`·모달 컨테이너·라우트)가 어떻게 자동 계측하는지가 이 레이어의
 * 논점이고, 그건 어디로 보내느냐와 무관하기 때문이다.
 *
 * **PII 를 여기 싣지 않는다.** 단말은 익명이고, 실을 수 있는 차원은 닫힌 집합이다.
 * 한 번 오염되면 그 뒤 모든 이벤트가 오염된다.
 */
let ready = false;
const logger = new Logger();

export function initAnalytics(): void {
  ready = true;
}

export function isAnalyticsReady(): boolean {
  return ready;
}

export function identify(traits: Record<string, string>): void {
  logger.info(`[분석] identify ${JSON.stringify(traits)}`);
}

export function group(name: string, id: string): void {
  logger.info(`[분석] group ${name}=${id}`);
}

export function register(props: Record<string, unknown>): void {
  logger.info(`[분석] register ${JSON.stringify(props)}`);
}

/** 실제 전송 지점. 어댑터를 바꾸면 여기 한 곳만 갈린다. */
export function captureRaw(
  event: string,
  props?: Record<string, unknown>,
): void {
  logger.info(`[분석] ${event}${props ? ` ${JSON.stringify(props)}` : ''}`);
}
