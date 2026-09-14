import { describe, expect, it } from 'bun:test';
import { charToMozcKey } from './keymap';

describe('charToMozcKey', () => {
  it('인쇄 문자 → UCS4 codePoint', () => {
    expect(charToMozcKey('a')).toEqual({ kind: 'codePoint', codePoint: 0x61 });
    expect(charToMozcKey('K')).toEqual({ kind: 'codePoint', codePoint: 0x4b });
  });

  it('제어 키 → special_key', () => {
    expect(charToMozcKey('\b')).toEqual({ kind: 'special', key: 'BACKSPACE' });
    expect(charToMozcKey(' ')).toEqual({ kind: 'special', key: 'SPACE' });
    expect(charToMozcKey('\n')).toEqual({ kind: 'special', key: 'ENTER' });
    expect(charToMozcKey('\r')).toEqual({ kind: 'special', key: 'ENTER' });
  });
});
