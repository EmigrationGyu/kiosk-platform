/**
 * 구분자 분리 전문 레이아웃 콤비네이터 — `fixedLayout` 의 형제.
 *
 * 고정길이 전문은 **폭**이 위치를 정하지만 구분자 전문은 **순서**가 정한다. 그래서 선언에 폭이 없고,
 * 이름을 순서대로 세워두면 인덱스가 도출된다 — 슬롯을 끼워 넣어도 뒤의 인덱스를 손으로 밀 일이 없다
 * (손으로 적으면 밀린 자리를 컴파일러가 못 잡는다: NVCAT 는 금액 자리에서 할부개월을 읽을 뿐이다).
 *
 * **프레이밍은 여기 없다** — 헤더·꼬리·구분자 결합이 전문마다 다르다(NICE 요청은 슬롯마다 붙는
 * 종결자, 응답은 슬롯 사이에만). 이 모듈은 **슬롯 배열 ↔ 이름** 하나만 책임진다. **폭도 여기 없다** —
 * 자릿수가 고정인 슬롯은 호출부가 만들어 넣는다.
 */

interface FieldPart<K extends string, Req extends boolean> {
  readonly kind: 'field';
  readonly name: K;
  readonly required: Req;
}

interface GapPart {
  readonly kind: 'gap';
  readonly count: number;
}

export type Part = FieldPart<string, boolean> | GapPart;

/** 명명 슬롯. 값을 반드시 넘겨야 한다(빈 값을 원하면 `''`). */
export const f = <const K extends string>(name: K): FieldPart<K, true> => ({
  kind: 'field',
  name,
  required: true,
});

/**
 * 값을 생략할 수 있는 명명 슬롯 — 생략하면 빈 슬롯이 된다.
 * NICE 의 부가세·봉사료·면세금액처럼 "비우면 데몬이 자체 계산" 인 자리.
 */
export const opt = <const K extends string>(name: K): FieldPart<K, false> => ({
  kind: 'field',
  name,
  required: false,
});

/** 빈 슬롯 `count` 개 — 사양 미명시/미사용 구간. 디코드 시 무시된다. */
export const gap = (count = 1): GapPart => ({ kind: 'gap', count });

type FieldsOf<P extends readonly Part[]> = Extract<
  P[number],
  { kind: 'field' }
>;
type RequiredNames<P extends readonly Part[]> = Extract<
  FieldsOf<P>,
  { required: true }
>['name'];
type OptionalNames<P extends readonly Part[]> = Extract<
  FieldsOf<P>,
  { required: false }
>['name'];

/** 인코딩 입력 — 필수 슬롯은 반드시, 선택 슬롯은 생략 가능. */
export type Values<P extends readonly Part[]> = Record<
  RequiredNames<P>,
  string | number
> &
  Partial<Record<OptionalNames<P>, string | number>>;

export interface FsLayout<P extends readonly Part[]> {
  /** 선언된 슬롯 수. 손으로 세지 않는다 — 전문 필드 개수 불변량의 출처. */
  readonly size: number;
  /** 슬롯 배열로 편다. 구분자 결합은 호출부의 프레이밍 몫. */
  encode(values: Values<P>): string[];
  /**
   * 슬롯 배열에서 이름 있는 자리만 뽑는다. 슬롯이 모자라면(잘린 응답) 빈 문자열이 된다 — 디코딩은
   * 총함수다. 값은 모두 trim 한다: V(N) 고정길이 공백 패딩이 도메인으로 새면 그 값을 다시 wire 에
   * 실을 때 단말이 거부한다(NICE 취소의 원승인번호).
   */
  decode(fields: readonly string[]): Record<FieldsOf<P>['name'], string>;
}

export function fsLayout<const P extends readonly Part[]>(
  parts: P,
): FsLayout<P> {
  let at = 0;
  const spans = parts.map((part) => {
    const index = at;
    at += part.kind === 'gap' ? part.count : 1;
    return { part, index };
  });
  const size = at;

  return {
    size,

    encode(values) {
      const slots = Array.from({ length: size }, () => '');
      for (const { part, index } of spans) {
        if (part.kind === 'gap') continue;
        // `?? ''` 라 0 은 '0' 으로 남는다 — `|| ''` 였다면 부가세 0 이 빈 슬롯이 된다.
        slots[index] = String(
          (values as Record<string, string | number | undefined>)[part.name] ??
            '',
        );
      }
      return slots;
    },

    decode(fields) {
      const out = {} as Record<FieldsOf<P>['name'], string>;
      for (const { part, index } of spans) {
        if (part.kind !== 'field') continue;
        out[part.name as FieldsOf<P>['name']] = (fields[index] ?? '').trim();
      }
      return out;
    },
  };
}
