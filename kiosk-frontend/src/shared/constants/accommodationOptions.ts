/**
 * `Accommodation.options` 는 스키마 필드가 아니라 `{ key, value }` 배열로
 * 들어오는 확장 옵션이다. 여기서 그 key 문자열을 상수로 고정한다.
 */
export const ACCOMMODATION_OPTION_KEYS = {
  /** 카드키 발급 시 카드에 인코딩할 호텔(사업장) 코드 */
  HOTEL_CODE: 'hotelCode',
} as const;
