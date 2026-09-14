import type { LogMeta } from './fields';

/**
 * 로그 메시지에 값을 보간하는 것을 **타입으로 막는다.**
 *
 * 값이 백틱 안에서 문자열로 뭉개지는 순간 "이게 이름인지 객실명인지"가 사라져, 아래(마스킹
 * 경계)에서 되찾을 방법이 없다. 라벨 관례(`예약자=${name}`)로 되찾아 보려 했으나 관례는
 * 강제가 아니라서 한 줄만 벗어나도 샌다. 그래서 **애초에 조립을 못 하게** 한다.
 *
 * 값은 전부 `meta` 로 가고, 문자열 조립은 `formatLogRecord` 한 곳에서만 일어난다.
 */

/**
 * 속성이 하나도 없는 객체 타입. **리터럴 키로 만든 매핑 타입에는 할당되지 않고, 인덱스
 * 시그니처에는 할당된다** — 이 비대칭이 아래 판정의 전부다. (`{}` 로 쓰면 biome 이 막는다.)
 */
type EmptyObject = Record<never, never>;

/**
 * 분해된 머리가 **구체 글자가 아니라 placeholder 인가.**
 *
 * 한 글자씩 분해할 때 placeholder 는 **자기 자신을 한 글자처럼** 내놓는다 —
 * `` `금액=${number}원` `` 의 머리는 `` `${number}` `` 이고 그 꼬리는 `''` 라 재귀가 거기서
 * `false` 로 끝난다(실측). 그래서 꼬리뿐 아니라 머리도 판정해야 한다.
 *
 * 앞의 세 판정은 값싸고, 마지막 `Record` 판정이 **브랜드 타입**(`number & $brand<'AmountWon'>`)
 * 을 잡는다. 브랜드된 placeholder 는 구체 글자와 할당가능성으로 구별되지 않는다 — 어느
 * 방향으로도 서로 할당되지 않는 불투명한 원자라서, `${number}`·`${bigint}` 같은 열거로는
 * 닿지 않는다(실측표). 매핑 타입만이 가른다: 구체 리터럴 키는 필수 속성이 되어 빈 객체가
 * 할당되지 않고, placeholder 키는 인덱스 시그니처가 되어 할당된다.
 *
 * **순서가 설계다.** `Record` 판정만 남기면 제네릭 호출 경로에서 판정이 지연돼 `LogArgs` 가
 * 튜플로 풀리지 않고, 그러면 보간뿐 아니라 **레지스트리 미등록 키 검사까지 통째로 무력화**된다
 * (실측). 값싼 판정이 대부분을 먼저 걸러 `Record` 가 드물게 닿아야 한다.
 *
 * `boolean`·`null`·`undefined` 는 `"true"|"false"` 같은 **구체 리터럴**로 접히므로 통과한다.
 * 닫힌 집합은 통과시킨다는 규칙이 그대로 적용된 결과다.
 */
type IsPlaceholder<H extends string> = string extends H
  ? true
  : `${number}` extends H
    ? true
    : `${bigint}` extends H
      ? true
      : EmptyObject extends Record<H, 1>
        ? true
        : false;

/**
 * 템플릿 리터럴에 **동적 값이 섞였는가.**
 *
 * TS 는 `` `예약자=${guestName}` `` 을 `string` 이 아니라 `` `예약자=${string}` `` 이라는
 * **패턴 타입**으로 추론한다. 그래서 `string extends M` 만으로는 안 걸리고, 한 글자씩
 * 분해해 머리나 꼬리에 placeholder 가 남는지를 봐야 한다.
 *
 * 리터럴 상수 보간(`${1}`·`${'lit'}`·리터럴 유니온)은 구체 리터럴로 접히므로 통과한다 —
 * 동적 데이터가 아니니 의도된 동작이다.
 */
export type HasDynamic<S extends string> = string extends S
  ? true
  : S extends `${infer Head}${infer Tail}`
    ? string extends Tail
      ? true
      : IsPlaceholder<Head> extends true
        ? true
        : HasDynamic<Tail>
    : false;

/**
 * 보간이 섞이면 **만족 불가능한 인자**를 요구해 호출을 막는다. 튜플 라벨이 그대로 에러
 * 메시지에 뜨므로, 개발자는 무엇을 해야 하는지 컴파일러에게서 직접 듣는다.
 *
 * `Tail` 은 정상 경로의 나머지 인자다 — `info` 는 `[meta?]`, `error` 는 `[err?, meta?]`.
 *
 * **판정을 튜플로 감싸 비분배로 비교한다.** `HasDynamic<M> extends true` 로 쓰면 일부만
 * 동적인 유니온(`${number | null}` → `true | false` = `boolean`)이 `true` 에 걸리지 않아
 * 그대로 통과한다(실측: electron 에서 `code=${code}` 가 그렇게 새고 있었다). `false` 가
 * **아닌 것을 전부** 막아야 섞인 유니온도 걸린다.
 */
export type LogArgs<
  M extends string,
  Tail extends unknown[] = [meta?: LogMeta],
> = [HasDynamic<M>] extends [false]
  ? Tail
  : [메시지에_값을_보간하지_마세요__두번째_인자_meta_로_넘기세요: never];

/** `info`/`warn`/`debug` 처럼 메시지 + meta 만 받는 시그니처. */
export type LogMessageArgs<M extends string> = LogArgs<M, [meta?: LogMeta]>;

/** `error` 처럼 원인(err)을 함께 받는 시그니처. */
export type LogErrorArgs<M extends string> = LogArgs<
  M,
  [err?: unknown, meta?: LogMeta]
>;
