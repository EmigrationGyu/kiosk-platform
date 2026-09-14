/**
 * fsLayout 콤비네이터 자체의 계약.
 *
 * 개별 전문 테스트(`NiceCodec.test.ts`)가 "이 표가 사양과 맞나" 를 본다면, 여기는
 * "표가 뭐든 슬롯 산수가 맞고 encode/decode 가 서로의 역인가" 를 본다.
 *
 * 이 콤비네이터가 없애려는 사고는 하나다 — **자리가 밀리는 것**. 밀린 자리는 길이도
 * 타입도 안 바뀌어서 아무도 못 잡고, 단말이 금액 자리에서 할부개월을 읽을 뿐이다.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { f, fsLayout, gap, opt, type Part } from './fsLayout';

/** 왕복이 성립하는 값 — 앞뒤 공백이 없어야 한다(decode 가 trim 한다). */
const value = fc.stringMatching(/^[A-Z0-9]{0,12}$/);

describe('fsLayout', () => {
  it('size 는 슬롯 수의 합 — gap(n) 은 n 개를 차지한다', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (gaps) => {
          // 이름 슬롯 하나 + gap 하나를 번갈아 세운다.
          const parts = gaps.flatMap((n, i) => [f(`f${i}`), gap(n)]) as Part[];
          const expected = gaps.length + gaps.reduce((a, b) => a + b, 0);
          expect(fsLayout(parts).size).toBe(expected);
        },
      ),
    );
  });

  it('encode 결과 슬롯 수는 입력과 무관하게 항상 size', () => {
    const L = fsLayout([f('a'), gap(3), opt('b'), gap(), f('c')]);
    fc.assert(
      fc.property(
        fc.string(),
        fc.option(fc.string(), { nil: undefined }),
        fc.string(),
        (a, b, c) => {
          expect(L.encode({ a, b, c })).toHaveLength(L.size);
        },
      ),
    );
  });

  it('decode ∘ encode = id — 앞뒤 공백 없는 값에 한해', () => {
    const L = fsLayout([f('first'), gap(2), f('second'), gap(), f('third')]);
    fc.assert(
      fc.property(value, value, value, (first, second, third) => {
        expect(L.decode(L.encode({ first, second, third }))).toEqual({
          first,
          second,
          third,
        });
      }),
    );
  });

  it('gap 구간은 디코드 결과에 나타나지 않는다', () => {
    const L = fsLayout([f('only'), gap(6)]);
    expect(Object.keys(L.decode(L.encode({ only: 'AB' })))).toEqual(['only']);
  });

  it('선택 슬롯을 생략해도 뒤 슬롯의 자리는 밀리지 않는다', () => {
    // 이 콤비네이터의 본업. NICE 는 부가세/봉사료/면세를 비운 채 보내는 일이 잦다.
    const L = fsLayout([f('head'), opt('skipped'), f('tail')]);
    expect(L.encode({ head: 'H', tail: 'T' })).toEqual(['H', '', 'T']);
    expect(L.decode(L.encode({ head: 'H', tail: 'T' })).tail).toBe('T');
  });

  it("0 은 빈 슬롯이 아니다 — `?? ''` 가 `|| ''` 로 바뀌면 여기서 걸린다", () => {
    // 부가세 0 원은 "0 을 보냈다" 이고, 빈 슬롯은 "데몬이 알아서 계산해라" 다.
    const L = fsLayout([opt('vat'), f('amount')]);
    expect(L.encode({ vat: 0, amount: 10_000 })).toEqual(['0', '10000']);
    expect(L.encode({ amount: 10_000 })).toEqual(['', '10000']);
  });

  it('슬롯이 모자라거나 남아도 디코딩은 총함수다', () => {
    const L = fsLayout([f('head'), gap(18), f('tail')]);
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 40 }), (fields) => {
        const decoded = L.decode(fields);
        expect(typeof decoded.head).toBe('string');
        expect(typeof decoded.tail).toBe('string');
      }),
    );
    // 잘린 응답 — 없는 자리는 빈 문자열.
    expect(L.decode(['ONLY']).tail).toBe('');
    // 여분 슬롯은 무시된다(요청 전문처럼 구분자가 종결자면 마지막에 빈 슬롯이 하나 더 붙는다).
    // head(0) + gap(1..18) 이므로 tail 은 19 번 — 인덱스는 size 에서 도출해 세지 않는다.
    const slots = Array.from({ length: L.size }, () => '');
    slots[L.size - 1] = 'TAIL';
    expect(L.decode([...slots, 'EXTRA']).tail).toBe('TAIL');
  });

  it('decode 는 V(N) 공백 패딩을 걷어낸다', () => {
    // 걷지 않으면 그 값을 다시 wire 에 실을 때 단말이 거부한다(NICE 취소의 원승인번호).
    const L = fsLayout([f('approvalNumber')]);
    expect(L.decode(['00012345   ']).approvalNumber).toBe('00012345');
  });
});
