/**
 * 알림 구독은 캐시에 쓰지 않는다 — 소비가 전부 `onData` 라 구독 결과를 캐시에서 읽는
 * 곳이 없는데, 기본값이면 알림 1건마다 엔티티가 정규화돼 `cache.gc()`(홈 복귀 전이)
 * 때까지 쌓인다. 무손님 구간에는 걷을 전이가 없어 알림 도착률만큼 계속 자란다.
 */
export const NOTIFICATION_SUBSCRIPTION_FETCH_POLICY = 'no-cache' as const;
