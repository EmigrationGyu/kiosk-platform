import { captureRaw, isAnalyticsReady } from './client';
import { shouldSample } from './config';
import type { AnalyticsEvent, AnalyticsEventMap } from './events';
import { getSessionId } from './session';

type EmptyProps = Record<string, never>;

/**
 * 타입안전 이벤트 발화 파사드 — **선언된 이벤트·props 만 허용**하므로 PII 가 구조적으로 못 샌다.
 *
 * 이벤트명은 항상 `ANALYTICS_EVENTS` 상수를 쓴다(리터럴 금지). props 없는 이벤트는
 * 이름만으로 호출 가능(preload IPC 의 `...args` 관용과 동일):
 *   track(ANALYTICS_EVENTS.CARD_ISSUED)
 *   track(ANALYTICS_EVENTS.PAYMENT, { method, result: ACTION_RESULT.SUCCESS })
 *
 * 미전송 조건은 여기서 한 번에 거른다: 비활성(개발/목/키없음) / 샘플링 탈락.
 */
export function track<E extends AnalyticsEvent>(
  event: E,
  ...args: AnalyticsEventMap[E] extends EmptyProps
    ? []
    : [props: AnalyticsEventMap[E]]
): void {
  if (!isAnalyticsReady()) return;
  if (!shouldSample(event)) return;
  const props = (args[0] ?? {}) as Record<string, unknown>;
  captureRaw(event, { ...props, sessionId: getSessionId() });
}
