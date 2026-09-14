/**
 * 이름 한 개(PascalCase·kebab·snake 무엇이든)를 받아 생성기 전역에서 쓰는 모든 표기형으로 파생한다.
 *
 * 기존 4개 생성기가 각자 `toScreamingSnake`/`toKebab` 등을 중복 구현하던 것을 한곳으로 통합한다.
 */
export type Names = {
  /** 입력 원문 */
  raw: string;
  /** PascalCase — 클래스/타입명 (CardkeyDispenser) */
  pascal: string;
  /** camelCase — 필드/변수명 (cardkeyDispenser) */
  camel: string;
  /** kebab-case — 패키지/디렉토리/파이프명 (cardkey-dispenser) */
  kebab: string;
  /** snake_case — 엔드포인트 경로 세그먼트 (cardkey_dispenser) */
  snake: string;
  /** SCREAMING_SNAKE_CASE — 상수/enum 키 (CARDKEY_DISPENSER) */
  screaming: string;
};

/** 입력을 소문자 토큰 배열로 분해한다 (camel 경계 + `-`/`_`/공백 분리). */
function tokenize(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar → foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // IOReader → IO Reader
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** 입력 이름을 모든 표기형으로 파생한다. 토큰이 하나도 없으면 throw. */
export function deriveNames(input: string): Names {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new Error(`이름을 파싱할 수 없습니다: '${input}'`);
  }
  const pascal = tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join('');
  return {
    raw: input,
    pascal,
    camel: pascal.charAt(0).toLowerCase() + pascal.slice(1),
    kebab: tokens.join('-'),
    snake: tokens.join('_'),
    screaming: tokens.join('_').toUpperCase(),
  };
}
