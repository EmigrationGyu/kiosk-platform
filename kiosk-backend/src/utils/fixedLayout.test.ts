/**
 * fixedLayout 콤비네이터 자체의 계약.
 *
 * 개별 전문 테스트가 "이 레이아웃이 사양과 맞나" 를 본다면, 여기는 "레이아웃이 뭐든
 * encode/decode 가 서로의 역이고 폭이 지켜지나" 를 본다.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import iconv from 'iconv-lite';
import { code, f, fill, gap, layout, type Part } from './fixedLayout';

/** 왕복이 성립하는 값 — ASCII(문자 수 = 바이트 수) + 앞뒤 공백 없음. */
const value = (max: number) =>
  fc.stringMatching(new RegExp(`^[A-Z0-9]{0,${max}}$`));

describe('fixedLayout', () => {
  it('width 는 선언된 폭의 합', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 20 }), {
          minLength: 1,
          maxLength: 12,
        }),
        (widths) => {
          const parts = widths.map((w, i) => f(`f${i}`, w)) as Part[];
          expect(layout(parts).width).toBe(widths.reduce((a, b) => a + b, 0));
        },
      ),
    );
  });

  it('encode 결과 길이는 입력과 무관하게 항상 width', () => {
    const L = layout([
      f('a', 4),
      gap(3),
      f('b', 6, { pad: 'left' }),
      fill('X', 2),
    ]);
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(L.encode({ a, b }).length).toBe(L.width);
      }),
    );
  });

  it('decode 는 EUC-KR 한글을 바이트 폭대로 읽는다', () => {
    // 응답 경로의 본업 — 발급사명 같은 한글 필드.
    const L = layout([f('issuer', 8), f('rest', 4)]);
    const buf = Buffer.concat([
      iconv.encode('국민카드', 'EUC-KR'), // 8 bytes
      Buffer.from('OK  ', 'ascii'),
    ]);
    expect(L.decode(buf)).toEqual({ issuer: '국민카드', rest: 'OK' });
  });

  it('encode 는 문자 수로 패딩한다 — 비-ASCII 는 바이트 폭을 넘긴다 (현재 동작)', () => {
    const L = layout([f('a', 6), f('b', 4)]);
    const wire = L.encode({ a: '가나다', b: 'OK' });
    expect(wire.length).toBe(L.width); // 문자 수로는 맞고
    expect(Buffer.byteLength(wire, 'utf8')).toBe(L.width + 6); // 바이트로는 넘친다
  });

  it('decode ∘ encode = id — ASCII 필드에 한해', () => {
    const L = layout([
      f('first', 8),
      gap(4),
      f('second', 10),
      code('third', 4),
      f('fourth', 12),
    ]);
    fc.assert(
      fc.property(
        value(8),
        value(10),
        fc.stringMatching(/^[0-9]{4}$/),
        value(12),
        (first, second, third, fourth) => {
          const wire = L.encode({ first, second, third, fourth });
          expect(L.decode(Buffer.from(wire, 'utf8'))).toEqual({
            first,
            second,
            third,
            fourth,
          });
        },
      ),
    );
  });

  it('gap/fill 구간은 디코드 결과에 나타나지 않는다', () => {
    const L = layout([f('only', 4), gap(6), fill('ZZ', 2)]);
    expect(
      Object.keys(L.decode(Buffer.from(L.encode({ only: 'AB' }), 'utf8'))),
    ).toEqual(['only']);
  });

  it('pad 는 padLeft/padRight 와 같은 의미 — 초과 시 잘리는 방향도 동일', () => {
    const L = layout([f('n', 4, { pad: 'left' }), f('s', 4)]);
    expect(L.encode({ n: 7, s: 'AB' })).toBe('0007AB  ');
    // left = slice(-4) 우측 유지 · right = slice(0,4) 좌측 유지
    expect(L.encode({ n: 123456, s: 'ABCDEF' })).toBe('3456ABCD');
  });

  it('code 필드는 trim 하지 않고, 일반 필드는 trim 한다', () => {
    const L = layout([code('raw', 6), f('trimmed', 6)]);
    const decoded = L.decode(Buffer.from('AB    AB    ', 'ascii'));
    expect(decoded.raw).toBe('AB    ');
    expect(decoded.trimmed).toBe('AB');
  });

  it('레이아웃보다 짧은 버퍼도 던지지 않고 빈 필드로 떨어진다', () => {
    const L = layout([code('head', 4), gap(18), code('tail', 4)]);
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 40 }), (bytes) => {
        const decoded = L.decode(Buffer.from(bytes));
        expect(typeof decoded.head).toBe('string');
        expect(typeof decoded.tail).toBe('string');
      }),
    );
    expect(L.decode(Buffer.from('1000', 'ascii')).tail).toBe('');
  });

  it('값이 빠지면 빈 문자열로 패딩된다 (encode 는 부분 입력을 허용)', () => {
    const L = layout([f('a', 3), f('b', 3)]);
    expect(L.encode({ a: 'X' } as never)).toBe('X     ');
  });
});
