import { describe, expect, it } from 'bun:test';
import {
  atEnd,
  concatBytes,
  cursorOf,
  readTag,
  readVarint,
  skipField,
  stringField,
  tag,
  toInt32,
  toUint32,
  varint,
  varintField,
  WIRE_TYPE,
} from './wire';

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('varint', () => {
  it('경계값 인코딩 박제', () => {
    expect(hex(varint(0))).toBe('00');
    expect(hex(varint(1))).toBe('01');
    expect(hex(varint(127))).toBe('7f');
    expect(hex(varint(128))).toBe('8001');
    expect(hex(varint(300))).toBe('ac02');
    expect(hex(varint(2n ** 64n - 1n))).toBe('ffffffffffffffffff01');
  });

  it('음수(int32/int64)는 64비트 2의 보수 10바이트', () => {
    expect(hex(varint(-1))).toBe('ffffffffffffffffff01');
    expect(hex(varint(-2))).toBe('feffffffffffffffff01');
  });

  it('라운드트립: 인코딩→디코딩 항등', () => {
    for (const v of [
      0n,
      1n,
      127n,
      128n,
      300n,
      2n ** 32n,
      2n ** 63n,
      2n ** 64n - 1n,
    ]) {
      expect(readVarint(cursorOf(varint(v)))).toBe(v);
    }
  });

  it('음수 int32 라운드트립 (toInt32 캐스팅)', () => {
    expect(toInt32(readVarint(cursorOf(varint(-3))))).toBe(-3);
    expect(toUint32(readVarint(cursorOf(varint(7))))).toBe(7);
  });

  it('절단/과길이 입력은 throw', () => {
    expect(() => readVarint(cursorOf(Uint8Array.from([0x80])))).toThrow();
    expect(() =>
      readVarint(cursorOf(Uint8Array.from({ length: 11 }, () => 0x80))),
    ).toThrow();
  });
});

describe('tag', () => {
  it('필드번호/와이어타입 라운드트립', () => {
    const c = cursorOf(tag(6, WIRE_TYPE.LEN));
    expect(readTag(c)).toEqual({ fieldNumber: 6, wireType: WIRE_TYPE.LEN });
  });
});

describe('skipField', () => {
  it('varint/fixed32/fixed64/len/중첩그룹 전부 건너뛰고 아는 필드에 도달', () => {
    const buf = concatBytes(
      varintField(90, 12345), // unknown varint
      tag(91, WIRE_TYPE.FIXED64),
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), // unknown fixed64
      tag(92, WIRE_TYPE.FIXED32),
      Uint8Array.from([9, 9, 9, 9]), // unknown fixed32
      stringField(93, 'unknown'), // unknown len
      // unknown group — 안에 varint + 또 다른 중첩 그룹까지
      tag(94, WIRE_TYPE.SGROUP),
      varintField(1, 7),
      tag(2, WIRE_TYPE.SGROUP),
      stringField(3, 'nested'),
      tag(2, WIRE_TYPE.EGROUP),
      tag(94, WIRE_TYPE.EGROUP),
      varintField(1, 42), // 아는 필드
    );
    const c = cursorOf(buf);
    let found: bigint | null = null;
    while (!atEnd(c)) {
      const { fieldNumber, wireType } = readTag(c);
      if (fieldNumber === 1 && wireType === WIRE_TYPE.VARINT) {
        found = readVarint(c);
      } else {
        skipField(c, wireType);
      }
    }
    expect(found).toBe(42n);
  });

  it('고아 EGROUP/절단 그룹은 throw', () => {
    expect(() =>
      skipField(cursorOf(new Uint8Array(0)), WIRE_TYPE.EGROUP),
    ).toThrow();
    // SGROUP 만 있고 EGROUP 없이 끝나는 입력
    const c = cursorOf(varintField(1, 7));
    readTag(c);
    readVarint(c);
    expect(() => skipField(c, WIRE_TYPE.SGROUP)).toThrow();
  });
});
