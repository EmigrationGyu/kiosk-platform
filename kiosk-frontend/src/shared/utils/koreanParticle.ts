/** 한글 음절 블록의 시작 코드포인트 (가). */
const HANGUL_SYLLABLE_START = 0xac00;
/** 한글 음절 블록의 끝 코드포인트 (힣). */
const HANGUL_SYLLABLE_END = 0xd7a3;
/** 한 초성·중성 조합당 종성 후보 수 (없음 포함). */
const JONGSEONG_COUNT = 28;

/**
 * 마지막 글자에 종성(받침)이 있는가.
 *
 * 한글 음절은 `0xAC00 + (초성×21 + 중성)×28 + 종성` 으로 배열돼 있어,
 * 28로 나눈 나머지가 0이면 종성이 없다.
 *
 * 한글 음절이 아니면(라틴·숫자·기호) **없음으로 본다** — 서비스명은 대부분
 * 한글이고, 아닌 경우의 관용 표기는 발음에 따라 갈려 규칙화할 수 없다.
 * (예: "Coffee" 는 [커피]라 "를", "Bill" 은 [빌]이라 "을".) 잘못 붙느니
 * 한쪽으로 고정하는 편이 예측 가능하다.
 */
const hasJongseong = (word: string): boolean => {
  const last = word.trim().at(-1);
  if (!last) return false;
  const code = last.codePointAt(0);
  if (
    code == null ||
    code < HANGUL_SYLLABLE_START ||
    code > HANGUL_SYLLABLE_END
  ) {
    return false;
  }
  return (code - HANGUL_SYLLABLE_START) % JONGSEONG_COUNT !== 0;
};

/**
 * 받침 유무로 갈리는 조사를 고른다 — "조식**을**" / "커피**를**".
 *
 * 조사를 **문장이 아니라 파라미터로** 넘기기 위한 함수다. Tolgee(ICU) 는
 * 한국어 받침 규칙을 모르므로, 번역문은 `"{name}{particle} 삭제할까요?"` 처럼
 * 자리만 두고 값은 여기서 만든다. 조사가 없는 언어의 번역문은 `{particle}` 을
 * 안 쓰면 그만이라 다른 언어를 오염시키지 않는다.
 *
 * @param word     조사가 붙을 말
 * @param withJong 받침이 있을 때 (을·이·은·과)
 * @param withoutJong 받침이 없을 때 (를·가·는·와)
 */
export const particleFor = (
  word: string,
  withJong: string,
  withoutJong: string,
): string => (hasJongseong(word) ? withJong : withoutJong);
