import { describe, expect, test } from 'bun:test';
import { particleFor } from './koreanParticle';

const objectParticle = (word: string) => particleFor(word, '을', '를');

describe('particleFor', () => {
  test('받침이 있으면 앞쪽 조사', () => {
    expect(objectParticle('조식')).toBe('을');
    expect(objectParticle('치킨')).toBe('을');
    expect(objectParticle('체크아웃 연장')).toBe('을');
  });

  test('받침이 없으면 뒤쪽 조사', () => {
    expect(objectParticle('커피')).toBe('를');
    expect(objectParticle('바베큐')).toBe('를');
  });

  test('종성 인덱스 0(받침 없음)과 그 외를 나눈다 — 나머지 연산 경계', () => {
    // '가'(0xAC00) = 받침 없음, '각'(0xAC01) = 받침 ㄱ
    expect(objectParticle('가')).toBe('를');
    expect(objectParticle('각')).toBe('을');
  });

  test('한글이 아니면 받침 없음으로 본다 — 규칙화할 수 없어 한쪽으로 고정', () => {
    expect(objectParticle('Coffee')).toBe('를');
    expect(objectParticle('세트2')).toBe('를');
    expect(objectParticle('스파(A)')).toBe('를');
  });

  test('꼬리 공백은 무시한다', () => {
    expect(objectParticle('조식 ')).toBe('을');
  });

  test('빈 문자열도 값을 낸다 — 호출부가 분기하지 않아도 된다', () => {
    expect(objectParticle('')).toBe('를');
    expect(objectParticle('   ')).toBe('를');
  });

  test('주격 조사도 같은 규칙', () => {
    expect(particleFor('조식', '이', '가')).toBe('이');
    expect(particleFor('커피', '이', '가')).toBe('가');
  });
});
