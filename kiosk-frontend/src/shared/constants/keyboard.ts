export const uppercaseTopKeys = [
  'KEYBOARD_Q',
  'KEYBOARD_W',
  'KEYBOARD_E',
  'KEYBOARD_R',
  'KEYBOARD_T',
  'KEYBOARD_Y',
  'KEYBOARD_U',
  'KEYBOARD_I',
  'KEYBOARD_O',
  'KEYBOARD_P',
] as const;

export const uppercaseMiddleKeys = [
  'KEYBOARD_A',
  'KEYBOARD_S',
  'KEYBOARD_D',
  'KEYBOARD_F',
  'KEYBOARD_G',
  'KEYBOARD_H',
  'KEYBOARD_J',
  'KEYBOARD_K',
  'KEYBOARD_L',
] as const;

export const uppercaseBottomKeys = [
  'KEYBOARD_Z',
  'KEYBOARD_X',
  'KEYBOARD_C',
  'KEYBOARD_V',
  'KEYBOARD_B',
  'KEYBOARD_N',
  'KEYBOARD_M',
] as const;

export const lowercaseTopKeys = [
  'KEYBOARD_q',
  'KEYBOARD_w',
  'KEYBOARD_e',
  'KEYBOARD_r',
  'KEYBOARD_t',
  'KEYBOARD_y',
  'KEYBOARD_u',
  'KEYBOARD_i',
  'KEYBOARD_o',
  'KEYBOARD_p',
] as const;

export const lowercaseMiddleKeys = [
  'KEYBOARD_a',
  'KEYBOARD_s',
  'KEYBOARD_d',
  'KEYBOARD_f',
  'KEYBOARD_g',
  'KEYBOARD_h',
  'KEYBOARD_j',
  'KEYBOARD_k',
  'KEYBOARD_l',
] as const;

export const lowercaseBottomKeys = [
  'KEYBOARD_z',
  'KEYBOARD_x',
  'KEYBOARD_c',
  'KEYBOARD_v',
  'KEYBOARD_b',
  'KEYBOARD_n',
  'KEYBOARD_m',
] as const;

export const upperEnglishTopKeys = [
  'Q',
  'W',
  'E',
  'R',
  'T',
  'Y',
  'U',
  'I',
  'O',
  'P',
] as const;
export const lowerEnglishTopKeys = [
  'q',
  'w',
  'e',
  'r',
  't',
  'y',
  'u',
  'i',
  'o',
  'p',
] as const;

export const upperEnglishMiddleKeys = [
  'A',
  'S',
  'D',
  'F',
  'G',
  'H',
  'J',
  'K',
  'L',
] as const;
export const lowerEnglishMiddleKeys = [
  'a',
  's',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
] as const;

export const upperEnglishBottomKeys = [
  'Z',
  'X',
  'C',
  'V',
  'B',
  'N',
  'M',
] as const;
export const lowerEnglishBottomKeys = [
  'z',
  'x',
  'c',
  'v',
  'b',
  'n',
  'm',
] as const;

export const SHIFT_KEY = '⇧';
export const BACKSPACE_KEY = '⌫';
export const RETURN_KEY = '↵';
export const SPACE_KEY = ' ';

export const LANGUAGE_TOGGLE_BUTTON_KEY =
  'TOLGEE_LANGUAGE_TOGGLE_BUTTON' as const;

export const firstNumberKeys = ['1', '2', '3'] as const;

export const secondNumberKeys = ['4', '5', '6'] as const;

export const thirdNumberKeys = ['7', '8', '9'] as const;

export const fourthNumberKeys = ['0', BACKSPACE_KEY] as const;

export const upperNumberKeys = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
] as const;

export const upperSpecialKeys = [
  '!',
  '@',
  '#',
  '$',
  '%',
  '^',
  '&',
  '*',
  '(',
  ')',
] as const;

export const KEYBOARD_TYPE = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
} as const;

export type KeyboardType = (typeof KEYBOARD_TYPE)[keyof typeof KEYBOARD_TYPE];
