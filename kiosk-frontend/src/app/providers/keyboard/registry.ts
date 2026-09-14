import NumberKeyboard from '@/shared/components/keyboard/NumberKeyboard';
import TextKeyboard from '@/shared/components/keyboard/TextKeyboard';
import { KEYBOARD_TYPE, type KeyboardType } from '@/shared/constants/keyboard';

export { KEYBOARD_TYPE, type KeyboardType };

function defineExactMap<K extends string>() {
  return <T extends Readonly<Record<K, unknown>>>(
    map: T & Record<Exclude<keyof T, K>, never>,
  ) => map;
}

export const KEYBOARD_MAP = defineExactMap<KeyboardType>()({
  [KEYBOARD_TYPE.TEXT]: TextKeyboard,
  [KEYBOARD_TYPE.NUMBER]: NumberKeyboard,
});
