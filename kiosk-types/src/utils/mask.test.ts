import { describe, expect, it, test } from 'bun:test';
import {
  maskBirth,
  maskCardNumber,
  maskDigits,
  maskName,
  maskPhone,
  maskVehicleNumber,
} from './mask';

describe('maskDigits', () => {
  it('구분자(-, 공백, +, .)는 보존하고 숫자 위치로만 마스킹', () => {
    expect(maskDigits('010-1234-5678', { keepStart: 3, keepEnd: 4 })).toBe(
      '010-****-5678',
    );
    expect(maskDigits('010 1234 5678', { keepStart: 3, keepEnd: 4 })).toBe(
      '010 **** 5678',
    );
    expect(maskDigits('01012345678', { keepStart: 3, keepEnd: 4 })).toBe(
      '010****5678',
    );
    expect(maskDigits('+82 10-1234-5678', { keepStart: 4, keepEnd: 4 })).toBe(
      '+82 10-****-5678',
    );
  });

  it('보존 자릿수 합이 전체 이상이면 그대로', () => {
    expect(maskDigits('123', { keepStart: 2, keepEnd: 2 })).toBe('123');
  });
});

describe('maskPhone — 가운데 2자리', () => {
  it('11자리 휴대폰: 010-1234-5678 → 010-1**4-5678', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-1**4-5678');
    expect(maskPhone('01012345678')).toBe('0101**45678');
  });

  it('구분자 달라도 동일하게 가운데 2자리만', () => {
    expect(maskPhone('010.1234.5678')).toBe('010.1**4.5678');
  });

  it('3자리 미만은 그대로', () => {
    expect(maskPhone('12')).toBe('12');
  });
});

describe('maskCardNumber — 앞 6자리만', () => {
  it('5525-7612-3456-7890 → 5525-76**-****-****', () => {
    expect(maskCardNumber('5525-7612-3456-7890')).toBe('5525-76**-****-****');
  });

  it('구분자 없는 PAN: 5525761234567890 → 552576**********', () => {
    expect(maskCardNumber('5525761234567890')).toBe('552576**********');
  });

  it('6자리 이하는 그대로 (가릴 게 없음)', () => {
    expect(maskCardNumber('552576')).toBe('552576');
  });
});

describe('maskName — 성명', () => {
  test('가운데를 가린다', () => {
    expect(maskName('홍길동')).toBe('홍*동');
    expect(maskName('남궁민수')).toBe('남**수');
  });
  test('2글자는 뒷글자, 1글자는 그대로', () => {
    expect(maskName('홍길')).toBe('홍*');
    expect(maskName('홍')).toBe('홍');
  });
  // 경계에서 마스킹하는데 출처가 이미 마스킹한 값이 올라올 수 있다.
  test('멱등 — 두 번 씌워도 같다', () => {
    expect(maskName(maskName('홍길동'))).toBe('홍*동');
    expect(maskName(maskName('남궁민수'))).toBe('남**수');
  });
  test('빈 값·공백을 삼키지 않는다', () => {
    expect(maskName('')).toBe('');
    expect(maskName('  홍길동  ')).toBe('홍*동');
  });
});

describe('maskBirth — 생년월일', () => {
  test('연도만 남긴다', () => {
    expect(maskBirth('19900101')).toBe('1990.**.**');
  });
  test('멱등', () => {
    expect(maskBirth(maskBirth('19900101'))).toBe('1990.**.**');
  });
  // 연도가 아닌 값이 들어오면 통째로 가린다 — 형식이 어긋난 값을 흘리는 쪽이 위험하다.
  test('형식이 어긋나면 전부 가린다', () => {
    expect(maskBirth('abc')).toBe('****.**.**');
    expect(maskBirth('')).toBe('****.**.**');
  });
});

describe('maskVehicleNumber — 차량번호', () => {
  test('앞뒤 2자리만 남긴다', () => {
    expect(maskVehicleNumber('12가3456')).toBe('12가**56');
  });
  test('멱등', () => {
    expect(maskVehicleNumber(maskVehicleNumber('12가3456'))).toBe('12가**56');
  });
  test('가릴 자리가 없으면 그대로', () => {
    expect(maskVehicleNumber('1234')).toBe('1234');
  });
});
