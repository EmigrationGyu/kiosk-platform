import { describe, expect, test } from 'bun:test';
import { matchesConfirmPhrase } from './confirmPhrase';

describe('전체 배포 확인 문구', () => {
  test('서버 이름을 그대로 쳐야 열린다', () => {
    expect(matchesConfirmPhrase('staging', 'staging')).toBe(true);
    expect(matchesConfirmPhrase('  staging ', 'staging')).toBe(true);
  });

  test('다른 서버 이름·대소문자·부분 입력은 닫혀 있다', () => {
    expect(matchesConfirmPhrase('development', 'staging')).toBe(false);
    expect(matchesConfirmPhrase('Staging', 'staging')).toBe(false);
    expect(matchesConfirmPhrase('stag', 'staging')).toBe(false);
    expect(matchesConfirmPhrase('', 'staging')).toBe(false);
  });
});
