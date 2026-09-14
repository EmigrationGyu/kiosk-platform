import { describe, expect, mock, test } from 'bun:test';

/**
 * wireInstant 단위 테스트.
 *
 * 이 파서의 계약은 "받는 형태는 닫힌 집합이고 나머지는 신뢰 불가" 하나뿐이라, 검증도
 * **경계 양쪽**에 집중한다 — 받아야 할 형태가 다 통과하는가, 그리고 통과하면 안 되는
 * 값(특히 **파싱에는 성공하는** 초 단위 epoch·YYYYMMDD)이 확실히 떨어지는가.
 */

// 실제 Logger 는 IPC 트랜스포트를 물고 있어 목한다. mock.module 은 전역이라 다른 파일의
// import 를 깨뜨리지 않도록 공개 인터페이스를 전부 스텁으로 채운다.
mock.module('@/shared/logger/Logger', () => ({
  Logger: class {
    info = mock((): void => undefined);
    error = mock((): void => undefined);
  },
}));

const {
  recognizeWireInstant,
  parseWireInstant,
  isTrustFailure,
  wireInstantRejectMessage,
  WIRE_INSTANT_FORM,
  WIRE_INSTANT_REJECT,
} = await import('./wireInstant');

/** 2026-05-11T15:00:00+09:00 == 2026-05-11T06:00:00Z */
const MAY_11_KST_3PM = Date.UTC(2026, 4, 11, 6, 0, 0);

describe('받아들이는 형태', () => {
  test('unix ms 숫자', () => {
    const r = recognizeWireInstant(MAY_11_KST_3PM);
    expect(r.ok && r.form).toBe(WIRE_INSTANT_FORM.EPOCH_MS_NUMBER);
    expect(r.ok && r.at.valueOf()).toBe(MAY_11_KST_3PM);
  });

  test('unix ms 문자열 — Reservation.intendedUse*', () => {
    const r = recognizeWireInstant(String(MAY_11_KST_3PM));
    expect(r.ok && r.form).toBe(WIRE_INSTANT_FORM.EPOCH_MS_STRING);
    expect(r.ok && r.at.valueOf()).toBe(MAY_11_KST_3PM);
  });

  test('ISO + Z — EphemeralOccupation.use*', () => {
    const r = recognizeWireInstant('2026-05-11T06:00:00.000Z');
    expect(r.ok && r.form).toBe(WIRE_INSTANT_FORM.ISO_OFFSET);
    expect(r.ok && r.at.valueOf()).toBe(MAY_11_KST_3PM);
  });

  test('ISO + 오프셋 — Z 와 같은 순간으로 읽는다', () => {
    const r = recognizeWireInstant('2026-05-11T15:00:00+09:00');
    expect(r.ok && r.form).toBe(WIRE_INSTANT_FORM.ISO_OFFSET);
    expect(r.ok && r.at.valueOf()).toBe(MAY_11_KST_3PM);
  });

  test('초·밀리초가 생략된 ISO 도 받는다', () => {
    expect(recognizeWireInstant('2026-05-11T15:00+09:00').ok).toBe(true);
    expect(recognizeWireInstant('2026-05-11T06:00:00.123Z').ok).toBe(true);
  });

  test('앞뒤 공백은 흘려보낸다', () => {
    expect(recognizeWireInstant(`  ${MAY_11_KST_3PM}  `).ok).toBe(true);
  });
});

describe('오프셋 없는 ISO — KST 로 가정', () => {
  test('+09:00 을 박은 것과 같은 순간으로 읽는다', () => {
    const r = recognizeWireInstant('2026-05-11T15:00:00');
    expect(r.ok && r.form).toBe(WIRE_INSTANT_FORM.ISO_ASSUMED_KST);
    expect(r.ok && r.at.valueOf()).toBe(MAY_11_KST_3PM);
  });

  test('로컬 TZ 와 무관하게 결정적이다', () => {
    // 이 단언이 이 분기의 존재 이유다 — dayjs 에 raw 를 그대로 넘기면 실행 환경의
    // TZ 로 읽혀 키오스크(KST)와 CI(UTC)가 9시간 갈린다.
    const naked = recognizeWireInstant('2026-05-11T15:00:00');
    const pinned = recognizeWireInstant('2026-05-11T15:00:00+09:00');
    expect(naked.ok && pinned.ok && naked.at.valueOf()).toBe(
      pinned.ok ? pinned.at.valueOf() : -1,
    );
  });

  test('가정한 값은 형태 태그로 구분된다', () => {
    const assumed = recognizeWireInstant('2026-05-11T15:00:00');
    const explicit = recognizeWireInstant('2026-05-11T15:00:00+09:00');
    expect(assumed.ok && explicit.ok && assumed.form === explicit.form).toBe(
      false,
    );
  });
});

describe('값 없음 — 신뢰 실패와 구분', () => {
  test.each([null, undefined, '', '   '])('%p → EMPTY', (value) => {
    const r = recognizeWireInstant(value);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.EMPTY);
  });
});

describe('형태 불일치 → NOT_RECOGNIZED', () => {
  test.each([
    ['날짜만 — 인스턴트가 아니라 하루를 뜻하므로 의미가 바뀐 것', '2026-05-11'],
    ['앞선 파싱 실패가 만들어낸 문자열', 'Invalid Date'],
    ['임의 문자열', 'hello'],
    ['자릿수는 맞지만 없는 날짜', '2026-13-45T00:00:00Z'],
    ['소수 문자열', '123.45'],
    ['오프셋이 깨진 ISO', '2026-05-11T15:00:00+0900'],
  ])('%s: %p', (_why, value) => {
    const r = recognizeWireInstant(value);
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.NOT_RECOGNIZED);
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
  ])('정수가 아닌 숫자 %p', (value) => {
    const r = recognizeWireInstant(value);
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.NOT_RECOGNIZED);
  });
});

describe('타당성 창 — 파싱에는 성공하지만 신뢰할 수 없는 값', () => {
  test('초 단위 epoch (10자리) — 1970 으로 떨어지는 대신 거절', () => {
    const seconds = Math.floor(MAY_11_KST_3PM / 1000);
    const r = recognizeWireInstant(seconds);
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.OUT_OF_WINDOW);
  });

  test('YYYYMMDD — unix ms 로 읽으면 1970 이라 모호하다', () => {
    const r = recognizeWireInstant('20260511');
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.OUT_OF_WINDOW);
  });

  test.each([
    0,
    -1,
    Date.UTC(1999, 11, 31),
    Date.UTC(2100, 0, 1),
  ])('창 밖 epoch %p', (value) => {
    const r = recognizeWireInstant(value);
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.OUT_OF_WINDOW);
  });

  test('창 밖 ISO 도 같은 기준으로 거절', () => {
    const r = recognizeWireInstant('1970-01-01T00:00:00Z');
    expect(!r.ok && r.reason).toBe(WIRE_INSTANT_REJECT.OUT_OF_WINDOW);
  });

  test('창 경계 — 하한은 포함, 상한은 배타', () => {
    expect(recognizeWireInstant(Date.UTC(2000, 0, 1)).ok).toBe(true);
    expect(recognizeWireInstant(Date.UTC(2099, 11, 31)).ok).toBe(true);
  });
});

describe('parseWireInstant — 소비처 API', () => {
  test('신뢰 가능하면 Dayjs', () => {
    expect(parseWireInstant(MAY_11_KST_3PM)?.valueOf()).toBe(MAY_11_KST_3PM);
  });

  test.each([
    null,
    '',
    '20260511',
    '2026-05-11',
    'hello',
  ])('신뢰 불가면 null: %p', (value) => {
    expect(parseWireInstant(value, 'intendedUseStartAt')).toBeNull();
  });
});

/**
 * 로그 호출 자체는 단언하지 않는다 — `mock.module` 은 전역이라 다른 파일의 Logger 목이
 * 이기면 호출 수 단언이 스위트 전체 실행에서만 깨진다(실제로 깨졌다). 대신 로그 여부를
 * 정하는 **정책과 문구**를 순수 함수로 뽑아 그걸 검증한다.
 */
describe('로그 정책', () => {
  test('EMPTY 는 조용히 — nullable 필드가 비어 온 것뿐이다', () => {
    expect(isTrustFailure(WIRE_INSTANT_REJECT.EMPTY)).toBe(false);
  });

  test.each([
    WIRE_INSTANT_REJECT.NOT_RECOGNIZED,
    WIRE_INSTANT_REJECT.OUT_OF_WINDOW,
  ])('신뢰 실패 %p 는 시끄럽게', (reason) => {
    expect(isTrustFailure(reason)).toBe(true);
  });

  test('문구에 필드 이름과 사유가 함께 실린다', () => {
    const message = wireInstantRejectMessage(
      'intendedUseStartAt',
      WIRE_INSTANT_REJECT.OUT_OF_WINDOW,
      '20260511',
    );
    expect(message).toContain('intendedUseStartAt');
    expect(message).toContain(WIRE_INSTANT_REJECT.OUT_OF_WINDOW);
    expect(message).toContain('20260511');
  });
});
