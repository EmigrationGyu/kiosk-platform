/**
 * 고정길이 텍스트 전문 레이아웃 콤비네이터.
 *
 * 폭만 선언하면 오프셋과 전체 길이는 도출된다 — 누적합을 손으로 계산하지 않는다.
 * 선언 하나에서 encode/decode 가 같이 나오므로 둘이 드리프트할 수 없다.
 *
 * **비대칭 주의**: decode 는 바이트로 슬라이스하고(응답에 EUC-KR 한글이 실린다),
 * encode 는 문자 수로 패딩한다(결과가 string 이라 호출측이 utf8 로 write 한다).
 * 따라서 `decode ∘ encode = id` 는 ASCII 필드에서만 성립한다 — 요청 전문은 전부
 * 숫자/영문이라 현재는 문제없지만, 비-ASCII 를 실으면 바이트 폭이 밀린다.
 * 바로잡으려면 encode 가 Buffer 를 반환해야 하고, 그건 write 경로까지 바뀐다.
 */

import iconv from 'iconv-lite';

/** `left` = 우측정렬 0 패딩 (N 타입) · `right` = 좌측정렬 공백 패딩 (AN 타입). */
export type Pad = 'left' | 'right';

interface FieldPart<K extends string> {
  readonly kind: 'field';
  readonly name: K;
  readonly width: number;
  readonly pad: Pad;
  readonly euckr: boolean;
  readonly trim: boolean;
}

interface FillPart {
  readonly kind: 'fill';
  readonly value: string;
  readonly width: number;
  readonly pad: Pad;
}

export type Part = FieldPart<string> | FillPart;

interface FieldOpts {
  pad?: Pad;
  /** false 면 ASCII 로 디코드하고 trim 하지 않는다 (코드/일시처럼 항상 꽉 찬 필드). */
  euckr?: boolean;
  trim?: boolean;
}

/** 명명 필드. 기본은 AN 타입 + EUC-KR + trim. */
export const f = <const K extends string>(
  name: K,
  width: number,
  opts: FieldOpts = {},
): FieldPart<K> => ({
  kind: 'field',
  name,
  width,
  pad: opts.pad ?? 'right',
  euckr: opts.euckr ?? true,
  trim: opts.trim ?? true,
});

/** ASCII 코드 필드 — 디코드 시 trim 하지 않는다. */
export const code = <const K extends string>(name: K, width: number) =>
  f(name, width, { euckr: false, trim: false });

/** 고정값 구간. 디코드 시 무시된다. */
export const fill = (
  value: string | number,
  width: number,
  pad: Pad = 'right',
): FillPart => ({ kind: 'fill', value: String(value), width, pad });

/** 공백 구간 — 응답의 미사용 필드 / 요청의 빈 필드. */
export const gap = (width: number): FillPart => fill('', width);

type NamesOf<P extends readonly Part[]> = Extract<
  P[number],
  { kind: 'field' }
>['name'];

export interface Layout<P extends readonly Part[]> {
  /** 선언된 폭의 합. 손으로 쓰지 않는다. */
  readonly width: number;
  decode(buf: Buffer): Record<NamesOf<P>, string>;
  encode(values: Record<NamesOf<P>, string | number>): string;
}

const padTo = (value: string, width: number, pad: Pad): string =>
  pad === 'left'
    ? value.padStart(width, '0').slice(-width)
    : value.padEnd(width, ' ').slice(0, width);

export function layout<const P extends readonly Part[]>(parts: P): Layout<P> {
  let at = 0;
  const spans = parts.map((part) => {
    const start = at;
    at += part.width;
    return { part, start };
  });
  const width = at;

  return {
    width,

    // 버퍼가 레이아웃보다 짧으면(잘린 응답) subarray 가 알아서 줄어들어 빈 필드가 된다.
    decode(buf) {
      const out = {} as Record<NamesOf<P>, string>;
      for (const { part, start } of spans) {
        if (part.kind !== 'field') continue;
        const slice = buf.subarray(start, start + part.width);
        const text = part.euckr
          ? iconv.decode(slice, 'EUC-KR')
          : slice.toString('ascii');
        out[part.name as NamesOf<P>] = part.trim ? text.trim() : text;
      }
      return out;
    },

    encode(values) {
      return spans
        .map(({ part }) =>
          part.kind === 'fill'
            ? padTo(part.value, part.width, part.pad)
            : padTo(
                String(values[part.name as NamesOf<P>] ?? ''),
                part.width,
                part.pad,
              ),
        )
        .join('');
    },
  };
}
