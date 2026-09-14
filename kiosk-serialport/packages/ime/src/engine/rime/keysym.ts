// 소프트 키보드가 낸 단일 문자 → rime ProcessKey 의 X11 keysym(keycode).
// 순수함수. 인쇄 가능 ASCII(0x20–0x7E)는 keysym == charCode 이고, 제어문자만 XK_* 로 매핑한다.

const XK_BackSpace = 0xff08;
const XK_Tab = 0xff09;
const XK_Return = 0xff0d;
const XK_Escape = 0xff1b;
const XK_Delete = 0xffff;

const CONTROL_KEYSYMS: Readonly<Record<string, number>> = {
  '\b': XK_BackSpace,
  '\t': XK_Tab,
  '\r': XK_Return,
  '\n': XK_Return,
  '\x1b': XK_Escape,
  '\x7f': XK_Delete,
};

/**
 * 단일 문자(계약상 key.length === 1)를 rime keysym 으로 변환.
 * 병음 입력은 a–z·숫자·스페이스라 대부분 charCode 그대로, 백스페이스 등만 XK_* 로 간다.
 */
export function charToKeysym(char: string): number {
  return CONTROL_KEYSYMS[char] ?? char.charCodeAt(0);
}
