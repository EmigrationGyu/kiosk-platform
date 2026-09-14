import { describe, expect, test } from 'bun:test';
import {
  LOG_FIELDS,
  type LogField,
  MASKERS,
  type MaskPolicy,
  maskLogMeta,
  maskLogValue,
  UNMASKED_KEY,
  UNREGISTERED_VALUE,
} from './fields';

describe('레지스트리 — 닫힌 집합', () => {
  // 정책을 늘렸는데 마스커를 안 만들면 여기가 아니라 컴파일이 먼저 막는다(satisfies).
  // 이 테스트는 그 계약이 살아 있다는 것을 런타임에서도 확인한다.
  test('모든 필드의 정책에 마스커가 있다 ★', () => {
    for (const policy of Object.values(LOG_FIELDS)) {
      expect(typeof MASKERS[policy as MaskPolicy]).toBe('function');
    }
  });

  test('모든 정책에 마스커가 있다 ★', () => {
    const policies: MaskPolicy[] = [
      'name',
      'birth',
      'phone',
      'vehicle',
      'card',
      'plain',
      'nested',
    ];
    for (const policy of policies) {
      expect(typeof MASKERS[policy]).toBe('function');
    }
  });

  // 같은 종류라도 키를 나눠야 로그를 읽는 사람이 "예약자인지 검색어인지"를 가린다.
  test('예약자명과 검색 입력이 서로 다른 필드다', () => {
    expect(LOG_FIELDS.guestName).toBe('name');
    expect(LOG_FIELDS.searchName).toBe('name');
    expect('guestName' in LOG_FIELDS && 'searchName' in LOG_FIELDS).toBe(true);
  });

  test('가리지 않는 필드도 명시적으로 선언되어 있다', () => {
    expect(LOG_FIELDS.roomName).toBe('plain');
    expect(MASKERS.plain('301')).toBe('301');
  });
});

describe('maskLogValue — 필드 하나', () => {
  test('정책대로 가린다', () => {
    expect(maskLogValue('guestName', '홍길동')).toBe('홍*동');
    expect(maskLogValue('birth', '19900101')).toBe('1990.**.**');
    expect(maskLogValue('vehicleNumber', '12가3456')).toBe('12가**56');
  });

  test('plain 은 그대로 통과한다', () => {
    expect(maskLogValue('roomName', '301')).toBe('301');
  });

  test('문자열이 아닌 값은 건드리지 않는다', () => {
    expect(maskLogValue('attempt', 2)).toBe(2);
    expect(maskLogValue('cause', null)).toBe(null);
    expect(maskLogValue('variant', true)).toBe(true);
  });

  /**
   * 같은 의미의 값이 여럿일 때 — 문자열로 이어 붙이면 `홍길동, 김철수` 가 한 덩어리라
   * 경계가 원소를 못 본다. 배열로 오면 **원소별로** 정확히 가려진다.
   */
  test('배열은 원소별로 가린다', () => {
    expect(maskLogValue('guestNames', ['홍길동', '김철수'])).toEqual([
      '홍*동',
      '김*수',
    ]);
  });
});

describe('maskLogMeta — 트리 전체', () => {
  test('필드마다 제 정책이 적용된다', () => {
    expect(
      maskLogMeta({ guestName: '홍길동', roomName: '301', attempt: 2 }),
    ).toEqual({ guestName: '홍*동', roomName: '301', attempt: 2 });
  });

  // 예약자와 검색어가 한 줄에 같이 나오는 것이 미검색 진단의 핵심이다.
  test('같은 종류의 다른 필드가 각자 가려진다', () => {
    expect(maskLogMeta({ guestName: '홍길동', searchName: '홍갈동' })).toEqual({
      guestName: '홍*동',
      searchName: '홍*동',
    });
  });

  test('중첩 객체는 안쪽 키가 다시 판정된다', () => {
    expect(
      maskLogMeta({
        matches: [
          { guestName: '홍길동', code: 0.82 },
          { guestName: '김철수', code: 0.61 },
        ],
      }),
    ).toEqual({
      matches: [
        { guestName: '홍*동', code: 0.82 },
        { guestName: '김*수', code: 0.61 },
      ],
    });
  });

  /**
   * 타입이 닿지 않는 면(소켓 와이어·서브프로세스 stdout)에서 온 레코드의 방어선.
   * 우리 코드에서는 컴파일이 먼저 막으므로 여기 걸리는 건 외부에서 온 것뿐이다.
   */
  test('미등록 키는 값을 버린다 — 키 이름은 남긴다', () => {
    expect(maskLogMeta({ ownerName: '홍길동', roomName: '301' })).toEqual({
      ownerName: UNREGISTERED_VALUE,
      roomName: '301',
    });
  });

  test('중첩 안쪽의 미등록 키도 버린다', () => {
    expect(maskLogMeta({ matches: [{ ownerName: '홍길동' }] })).toEqual({
      matches: [{ ownerName: UNREGISTERED_VALUE }],
    });
  });

  test('meta 가 객체가 아니면 그대로', () => {
    expect(maskLogMeta(undefined)).toBeUndefined();
    expect(maskLogMeta('문자열')).toBe('문자열');
    expect(maskLogMeta(3)).toBe(3);
  });
});

describe('타입 — 미등록 키는 컴파일이 막는다', () => {
  /**
   * 런타임 방어(`UNREGISTERED_VALUE`)는 외부 입력용이고, **우리 코드의 1차 방어는 타입**이다.
   * 아래 주석 해제 시 TS2353 이 나야 한다 — 자동 검증이 안 되므로 의도를 여기 남긴다.
   *
   *   const bad: LogMeta = { ownerName: '홍길동' };
   *   //                     ^^^^^^^^^ 'ownerName' does not exist in type ...
   */
  test('등록된 키는 LogField 로 좁혀진다', () => {
    const field: LogField = 'guestName';
    expect(LOG_FIELDS[field]).toBe('name');
  });
});

/**
 * 탈출구. 장비 프로토콜 진단처럼 어휘가 무한한 값을 레지스트리에 다 등록하면 400개가 넘어
 * PII 항목이 파묻히고, 결국 메시지에 욱여넣는 우회로가 생긴다. 문 하나를 이름 붙여 열어두고
 * **쓰는 것을 선언으로** 삼는다.
 */
describe('unmasked — 선언된 탈출구', () => {
  test('안쪽 값은 레지스트리를 타지 않는다', () => {
    expect(
      maskLogMeta({ unmasked: { expected: '0x1f', portPath: 'COM3' } }),
    ).toEqual({ unmasked: { expected: '0x1f', portPath: 'COM3' } });
  });

  test('등록 필드와 한 호출에 섞여도 각자 처리된다', () => {
    expect(
      maskLogMeta({ guestName: '홍길동', unmasked: { sdkCode: 31 } }),
    ).toEqual({ guestName: '홍*동', unmasked: { sdkCode: 31 } });
  });

  // 막을 수 없는 구멍이라는 것을 박제한다 — 레지스트리를 신뢰하는 설계의 대가다.
  // (`guestName: 'plain'` 으로 잘못 등록해도 똑같이 샌다.)
  test('여기 개인정보를 넣으면 그대로 나간다 — 그래서 grep 으로 감사한다', () => {
    expect(maskLogMeta({ unmasked: { guestName: '홍길동' } })).toEqual({
      unmasked: { guestName: '홍길동' },
    });
  });

  test('예약어라 레지스트리 필드와 겹치지 않는다 ★', () => {
    expect(UNMASKED_KEY in LOG_FIELDS).toBe(false);
  });
});
