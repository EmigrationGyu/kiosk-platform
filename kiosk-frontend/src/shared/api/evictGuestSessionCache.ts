import type { ApolloCache } from '@apollo/client';

/**
 * 게스트 세션 스코프 정규화 엔티티 typename — 세션 종료 시 수거하는 닫힌 집합.
 * Reservation = PII 포함 예약, EphemeralOccupation = walk-in 임시 점유
 * (뮤테이션으로만 정규화돼 ROOT_QUERY 미도달 — gc 만으로도 걷히지만 의도를 명시).
 */
const GUEST_SCOPED_TYPENAMES = ['Reservation', 'EphemeralOccupation'] as const;

/**
 * 게스트 상호작용이 만든 조회 결과의 ROOT_QUERY 필드 — 인자 조합 전체가 함께 수거된다.
 * - getReservations / getSingleReservation: 예약 검색·객실키 인식 결과 (PII)
 * - searchAvailableRatePlans / roomTypeDailyInventories: walk-in 요금·재고 스냅샷
 *   (세션 시점 데이터 — 다음 게스트에게 stale 노출 방지)
 * - getSingleRoom: 객실키 인식 시 단건 조회 (Room 엔티티 자체는 accommodation
 *   경유로 도달 가능해 보존되고, 조회 결과 필드만 걷힌다)
 * - quoteEarlyCheckInFee / quoteLateCheckoutFee: 예약 id + 의도 시각이 키에 박히는
 *   견적 — 세션마다 새 조합이라 걷지 않으면 ROOT_QUERY 가 영구히 자란다
 * 업장 설정성 조회(getMyAccommodations/getAccommodationKiosks/getAccommodationChannelList,
 * @client 필드)는 게스트 무관이므로 대상이 아니다.
 */
const GUEST_SCOPED_ROOT_FIELDS = [
  'getReservations',
  'getSingleReservation',
  'searchAvailableRatePlans',
  'roomTypeDailyInventories',
  'getSingleRoom',
  'quoteEarlyCheckInFee',
  'quoteLateCheckoutFee',
] as const;

/**
 * 게스트 세션 스코프 서버 상태를 Apollo 캐시에서 수거한다.
 *
 * 홈 복귀 = 세션 종료(useSafeGoHome)가 단일 리셋 지점 — 이전 게스트의 예약/임시점유가
 * 캐시에 남아 다음 세션의 fragment 구독·캐시 읽기에 새는 것을 여기서 차단한다.
 * (예: 서비스 추가 페이지는 캐시의 ReservationFields 구독이 데이터 소스라,
 * 세션을 넘긴 예약이 남아 있으면 진입 계약이 무의미해진다.)
 *
 * 업장·키오스크 옵션·객실 등은 Boot 가 채우고 cache-only 로 소비하므로 보존한다 —
 * 이들은 ROOT_QUERY(getMyAccommodations/getAccommodationKiosks 등)에서 도달 가능해
 * gc 에 수거되지 않는다.
 *
 * @returns 수거된 캐시 id 목록 (로그용)
 */
export const evictGuestSessionCache = (cache: ApolloCache): string[] => {
  for (const fieldName of GUEST_SCOPED_ROOT_FIELDS) {
    cache.evict({ id: 'ROOT_QUERY', fieldName });
  }
  const guestEntityIds = Object.keys(
    cache.extract() as Record<string, unknown>,
  ).filter((cacheId) =>
    GUEST_SCOPED_TYPENAMES.some((typename) =>
      cacheId.startsWith(`${typename}:`),
    ),
  );
  for (const cacheId of guestEntityIds) {
    cache.evict({ id: cacheId });
  }
  // gc 는 명시 evict 에 더해, 수거된 엔티티에서만 도달 가능하던 부속 섬
  // (Folio 등 예약 하위 정규화 엔티티)까지 함께 걷어낸다.
  const collected = cache.gc();
  return [...new Set([...guestEntityIds, ...collected])];
};
