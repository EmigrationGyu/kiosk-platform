import { describe, expect, it } from 'bun:test';
import {
  normalizeKoreanReading,
  readNumberWithCounter,
} from './korean-reading';

describe('readNumberWithCounter', () => {
  it('고유어 단위는 수관형사로 읽는다', () => {
    expect(readNumberWithCounter(1, '명')).toBe('한 명');
    expect(readNumberWithCounter(2, '개')).toBe('두 개');
    expect(readNumberWithCounter(4, '명')).toBe('네 명');
    expect(readNumberWithCounter(4, '시')).toBe('네 시');
    expect(readNumberWithCounter(2, '시간')).toBe('두 시간');
    expect(readNumberWithCounter(6, '자리')).toBe('여섯 자리');
    expect(readNumberWithCounter(20, '명')).toBe('스무 명');
  });

  it('한자어 단위는 한자어 수사로 읽는다', () => {
    expect(readNumberWithCounter(50000, '원')).toBe('오만 원');
    expect(readNumberWithCounter(301, '호')).toBe('삼백일 호');
    expect(readNumberWithCounter(30, '분')).toBe('삼십 분');
  });

  it('한자어 단위의 비숫자 라벨값은 원어 그대로 둔다', () => {
    expect(readNumberWithCounter('stay101', '호')).toBe('stay101 호');
  });
});

describe('normalizeKoreanReading', () => {
  it('시간 값의 시/분을 올바르게 읽는다', () => {
    expect(normalizeKoreanReading('오후 4시 30분')).toBe('오후 네 시 삼십 분');
    expect(normalizeKoreanReading('2시간 남았습니다')).toBe(
      '두 시간 남았습니다',
    );
  });

  it('정적 텍스트의 자리를 고유어로 읽는다', () => {
    expect(normalizeKoreanReading('차량번호 뒤 4자리를 입력해 주세요.')).toBe(
      '차량번호 뒤 네 자리를 입력해 주세요.',
    );
    expect(normalizeKoreanReading('비밀번호 6자리')).toBe('비밀번호 여섯 자리');
  });

  it('단위 없는 숫자/한자어 금액은 건드리지 않는다', () => {
    expect(normalizeKoreanReading('5만원 이상 결제 시')).toBe(
      '5만원 이상 결제 시',
    );
  });
});
