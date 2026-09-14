import { describe, expect, test } from 'bun:test';
import { InMemoryCache } from '@apollo/client';
import { evictGuestSessionCache } from './evictGuestSessionCache';

/**
 * 세션 종료 캐시 수거 — 게스트 스코프(예약·임시점유)는 사라지고,
 * Boot 가 채우는 cache-only 소비 데이터(업장·키오스크)는 보존되는지 박제.
 */
const buildSessionCache = () => {
  const cache = new InMemoryCache();
  cache.restore({
    ROOT_QUERY: {
      __typename: 'Query',
      // 예약 조회(체크인 검색 / 객실키 인식) 흔적 — 인자 조합별 필드
      'getReservations({"accommodationId":"a1"})': {
        __typename: 'ReservationConnection',
        edges: [
          { __typename: 'ReservationEdge', node: { __ref: 'Reservation:r1' } },
        ],
      },
      'getSingleReservation({"reservationId":"r2"})': {
        __ref: 'Reservation:r2',
      },
      // walk-in 요금 검색·재고 스냅샷 / 객실키 인식 단건 조회 흔적
      'searchAvailableRatePlans({"input":{"sleeps":2}})': {
        __typename: 'SearchAvailableRatePlansResult',
      },
      'roomTypeDailyInventories({"accommodationId":"a1"})': [],
      'getSingleRoom({"id":"room1"})': { __ref: 'Room:room1' },
      // 예약 id + 의도 시각이 키에 박히는 견적 — 세션마다 새 조합이 생긴다
      'quoteEarlyCheckInFee({"reservationId":"r2","intendedCheckInAt":"2026-09-04T05:00:00.000Z"})':
        { __typename: 'CheckTimeAdjustmentQuote', fee: 10000 },
      'quoteLateCheckoutFee({"reservationId":"r2","intendedCheckOutAt":"2026-09-05T02:00:00.000Z"})':
        { __typename: 'CheckTimeAdjustmentQuote', fee: 20000 },
      // Boot 가 채우는 장수 데이터
      getMyAccommodations: [{ __ref: 'Accommodation:a1' }],
      'getAccommodationKiosks({"id":"a1"})': [{ __ref: 'Kiosk:k1' }],
    },
    'Reservation:r1': {
      __typename: 'Reservation',
      id: 'r1',
      folio: { __ref: 'Folio:f1' },
    },
    'Reservation:r2': { __typename: 'Reservation', id: 'r2' },
    // 예약에서만 도달 가능한 부속 섬 — gc 로 함께 수거되어야 한다
    'Folio:f1': { __typename: 'Folio', id: 'f1' },
    // 뮤테이션으로만 정규화되는 walk-in 임시 점유 (ROOT_QUERY 참조 없음)
    'EphemeralOccupation:e1': { __typename: 'EphemeralOccupation', id: 'e1' },
    'Accommodation:a1': {
      __typename: 'Accommodation',
      id: 'a1',
      rooms: [{ __ref: 'Room:room1' }],
    },
    'Room:room1': { __typename: 'Room', id: 'room1' },
    'Kiosk:k1': { __typename: 'Kiosk', id: 'k1' },
  });
  return cache;
};

describe('evictGuestSessionCache', () => {
  test('게스트 스코프 엔티티(예약·임시점유·부속 섬)를 전부 수거한다', () => {
    const cache = buildSessionCache();
    evictGuestSessionCache(cache);
    const remaining = Object.keys(cache.extract());

    expect(remaining).not.toContain('Reservation:r1');
    expect(remaining).not.toContain('Reservation:r2');
    expect(remaining).not.toContain('EphemeralOccupation:e1');
    expect(remaining).not.toContain('Folio:f1');
  });

  test('게스트 조회 ROOT_QUERY 필드가 인자 조합 무관하게 수거된다', () => {
    const cache = buildSessionCache();
    evictGuestSessionCache(cache);
    const rootQuery = (cache.extract() as Record<string, object>).ROOT_QUERY;
    const rootFields = Object.keys(rootQuery ?? {});

    expect(rootFields.some((f) => f.startsWith('getReservations'))).toBeFalse();
    expect(
      rootFields.some((f) => f.startsWith('getSingleReservation')),
    ).toBeFalse();
    expect(
      rootFields.some((f) => f.startsWith('searchAvailableRatePlans')),
    ).toBeFalse();
    expect(
      rootFields.some((f) => f.startsWith('roomTypeDailyInventories')),
    ).toBeFalse();
    expect(rootFields.some((f) => f.startsWith('getSingleRoom'))).toBeFalse();
    expect(
      rootFields.some((f) => f.startsWith('quoteEarlyCheckInFee')),
    ).toBeFalse();
    expect(
      rootFields.some((f) => f.startsWith('quoteLateCheckoutFee')),
    ).toBeFalse();
  });

  test('업장·키오스크 등 Boot 스코프 데이터는 보존된다', () => {
    const cache = buildSessionCache();
    evictGuestSessionCache(cache);
    const remaining = Object.keys(cache.extract());

    expect(remaining).toContain('Accommodation:a1');
    expect(remaining).toContain('Kiosk:k1');
    // getSingleRoom 조회 필드는 걷혀도 Room 엔티티는 업장 경유로 도달 가능해 보존
    expect(remaining).toContain('Room:room1');
  });

  test('수거된 캐시 id 목록을 반환한다 (로그용)', () => {
    const cache = buildSessionCache();
    const evicted = evictGuestSessionCache(cache);

    expect(evicted).toContain('Reservation:r1');
    expect(evicted).toContain('EphemeralOccupation:e1');
  });
});
