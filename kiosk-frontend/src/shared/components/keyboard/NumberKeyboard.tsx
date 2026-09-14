import { useEffect } from 'react';
import { Subject } from 'rxjs';
import BackspaceIcon from '@/assets/keyboard/keyboard_backspace.svg?react';
import {
  firstNumberKeys,
  fourthNumberKeys,
  secondNumberKeys,
  thirdNumberKeys,
} from '@/shared/constants/keyboard';
import { useConst } from '@/shared/hooks/useConst';
import type { KeyboardProps } from '@/shared/lib/keyboard/types';
import { KEY_CLICK_VARIANTS } from '@/shared/lib/keyClick/keyClick';
import KeyboardKey from './KeyboardKey';
import SpecialKey from './SpecialKey';

const [zero, backspace] = fourthNumberKeys;

const NumberKeyboard = ({ onKeyPress }: KeyboardProps) => {
  const keyPressSubject = useConst(() => new Subject<string>());
  useEffect(() => {
    const subscription = keyPressSubject.subscribe((key) => {
      onKeyPress(key);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [onKeyPress, keyPressSubject]);

  return (
    <div className="flex flex-col items-center justify-center gap-space-3 w-max px-space-3 py-space-2">
      <div className="flex w-full justify-center gap-x-space-3">
        {firstNumberKeys.map((key) => (
          <KeyboardKey
            key={key}
            label={key}
            onKeyPress={(key) => keyPressSubject.next(key)}
            width="103px"
            height="53px"
          />
        ))}
      </div>
      <div className="flex w-full justify-center gap-x-space-3">
        {secondNumberKeys.map((key) => (
          <KeyboardKey
            key={key}
            label={key}
            onKeyPress={(key) => keyPressSubject.next(key)}
            width="103px"
            height="53px"
          />
        ))}
      </div>
      <div className="flex w-full justify-center gap-x-space-3">
        {thirdNumberKeys.map((key) => (
          <KeyboardKey
            key={key}
            label={key}
            onKeyPress={(key) => keyPressSubject.next(key)}
            width="103px"
            height="53px"
          />
        ))}
      </div>
      <div className="flex w-full justify-end gap-x-space-3">
        <KeyboardKey
          label={zero}
          onKeyPress={(key) => keyPressSubject.next(key)}
          width="103px"
          height="53px"
        />
        <SpecialKey
          content={<BackspaceIcon />}
          clickVariant={KEY_CLICK_VARIANTS.DELETE}
          onKeyPress={() => keyPressSubject.next(backspace)}
          width="103px"
          height="53px"
        />
      </div>
    </div>
  );
};

export default NumberKeyboard;
