import { describe, expect, it } from 'bun:test';
import { charToKeysym } from './keysym';

describe('charToKeysym', () => {
  it('인쇄 가능 ASCII 는 charCode 그대로 (병음 a–z)', () => {
    expect(charToKeysym('a')).toBe(0x61);
    expect(charToKeysym('n')).toBe(0x6e);
    expect(charToKeysym('z')).toBe(0x7a);
  });

  it('숫자·스페이스도 charCode', () => {
    expect(charToKeysym('1')).toBe(0x31);
    expect(charToKeysym('0')).toBe(0x30);
    expect(charToKeysym(' ')).toBe(0x20);
  });

  it('제어문자는 XK_* 로 매핑', () => {
    expect(charToKeysym('\b')).toBe(0xff08); // BackSpace
    expect(charToKeysym('\r')).toBe(0xff0d); // Return
    expect(charToKeysym('\n')).toBe(0xff0d); // Return
    expect(charToKeysym('\t')).toBe(0xff09); // Tab
    expect(charToKeysym('\x1b')).toBe(0xff1b); // Escape
    expect(charToKeysym('\x7f')).toBe(0xffff); // Delete
  });
});
