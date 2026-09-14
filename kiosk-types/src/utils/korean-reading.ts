import { numberToHangul, susa } from 'es-hangul';

/**
 * 한국어 숫자 읽기 정규화 — TTS 가 한자어로만 읽어 생기는 오독을 막는다.
 *
 * 한국어 수 체계는 단위에 따라 둘로 갈린다:
 *  - 고유어 수사(수관형사): 시·시간·명·개·자리 등 → 네 시, 네 명, 네 자리  (susa)
 *  - 한자어 수사: 원·호·분·초 등 → 오만 원, 삼백일 호, 삼십 분            (numberToHangul)
 *
 * 예) "4시" 를 TTS 가 "사시"로 읽는 문제 → "네 시" 로 교정.
 * 카운터 단위는 음성 매니페스트(AUDIO_SEGMENT_MANIFEST)의 변수 토큰에 바인딩되어 전달된다.
 */

/** 고유어 수사(수관형사)로 읽는 단위. 그 외는 모두 한자어로 읽는다. */
const NATIVE_COUNTERS = new Set([
  '시',
  '시간',
  '명',
  '개',
  '자리',
  '살',
  '마리',
  '대',
  '잔',
  '병',
  '권',
  '군데',
  '번',
  '가지',
  '켤레',
  '그루',
  '송이',
  '채',
  '척',
  '벌',
  '쌍',
]);

/**
 * 숫자 + 단위 → 한국어 발화.
 *  - 고유어 단위(명/개/시…): 수관형사로 — 4 → '네 명'  (TTS 가 '사 명'으로 오독하는 걸 교정)
 *  - 한자어 단위(원/호…): 숫자값은 한자어로(50000 → '오만 원'), 라벨값(방번호 'stay101' 등)은
 *    원어 그대로 — TTS 가 한자어 숫자는 정확히 읽으므로 변환 불필요, 라벨은 변환 불가.
 * 예: (4,'명')→'네 명', (50000,'원')→'오만 원', (301,'호')→'삼백일 호', ('stay101','호')→'stay101 호'.
 */
export function readNumberWithCounter(
  value: string | number,
  counter: string,
): string {
  if (NATIVE_COUNTERS.has(counter)) {
    return `${susa(Number(value), true)} ${counter}`;
  }
  const n = Number(value);
  const reading =
    Number.isFinite(n) && `${value}`.trim() !== '' ? numberToHangul(n) : value;
  return `${reading} ${counter}`;
}

// 자유 텍스트에 박힌 "숫자+단위". 긴 단위 우선(시간 > 시). 시간 값/정적 텍스트용.
const EMBEDDED = /(\d+)\s*(시간|시|분|초|자리)/g;

/**
 * 한국어 자유 텍스트의 숫자 읽기 정규화. 시간 값("오후 4시 30분"→"오후 네 시 삼십 분"),
 * 정적 텍스트("4자리"→"네 자리")에 쓴다. ko 전용.
 */
export function normalizeKoreanReading(text: string): string {
  return text.replace(EMBEDDED, (_, n: string, counter: string) =>
    readNumberWithCounter(Number(n), counter),
  );
}
