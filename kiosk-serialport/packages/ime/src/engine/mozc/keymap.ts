// 프론트 키보드 키 문자열 → mozc KeyEvent 매핑(순수). rime 의 charToKeysym 대응물.
// 프론트 계약: 인쇄 문자 그대로 + 백스페이스='\b' (KeyboardTextInput 의 CJK 라우팅).

import type { MozcKey } from './proto/commands';

export function charToMozcKey(key: string): MozcKey {
  switch (key) {
    case '\b':
      return { kind: 'special', key: 'BACKSPACE' };
    case ' ':
      // 조합 중 스페이스 = mozc 변환 트리거(일본어 IME 표준 동작).
      return { kind: 'special', key: 'SPACE' };
    case '\n':
    case '\r':
      return { kind: 'special', key: 'ENTER' };
    default:
      return { kind: 'codePoint', codePoint: key.codePointAt(0) ?? 0 };
  }
}
