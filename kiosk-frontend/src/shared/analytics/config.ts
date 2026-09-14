import { ANALYTICS_EVENTS, type AnalyticsEvent } from './events';

/**
 * 이벤트별 샘플링 게이트 — 비용/볼륨을 코드로 조절하는 단일 지점.
 *
 * 퍼널 백본·분기 액션은 항상 1.0(전수). ui_press 처럼 고볼륨·저신호 이벤트만 샘플링해
 * PostHog 무료 한도/요금을 통제한다. (sampleRate: 1 = 전수, 0 = 차단)
 */
type EventPolicy = { sampleRate: number };

const DEFAULT_POLICY: EventPolicy = { sampleRate: 1 };

const POLICIES: Partial<Record<AnalyticsEvent, EventPolicy>> = {
  // ui_press 만 고볼륨이라 샘플링. 필드 이벤트는 저볼륨·고신호라 전수(기본 1.0).
  [ANALYTICS_EVENTS.UI_PRESS]: { sampleRate: 0.1 },
};

export function shouldSample(event: AnalyticsEvent): boolean {
  const rate = (POLICIES[event] ?? DEFAULT_POLICY).sampleRate;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}
