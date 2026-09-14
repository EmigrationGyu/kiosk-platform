import { useTranslate } from '@tolgee/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Subject } from 'rxjs';
import BackspaceIcon from '@/assets/keyboard/keyboard_backspace.svg?react';
import ReturnIcon from '@/assets/keyboard/keyboard_return.svg?react';
import ShiftIcon from '@/assets/keyboard/keyboard_shift.svg?react';
import { LANGUAGES } from '@/shared/constants/i18n';
import {
  BACKSPACE_KEY,
  lowercaseBottomKeys,
  lowercaseMiddleKeys,
  lowercaseTopKeys,
  lowerEnglishBottomKeys,
  lowerEnglishMiddleKeys,
  lowerEnglishTopKeys,
  RETURN_KEY,
  SPACE_KEY,
  uppercaseBottomKeys,
  uppercaseMiddleKeys,
  uppercaseTopKeys,
  upperEnglishBottomKeys,
  upperEnglishMiddleKeys,
  upperEnglishTopKeys,
  upperNumberKeys,
  upperSpecialKeys,
} from '@/shared/constants/keyboard';
import { useConst } from '@/shared/hooks/useConst';
import { KEYBOARD_TRANSITION } from '@/shared/lib/keyboard/constants';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';
import type { KeyboardProps } from '@/shared/lib/keyboard/types';
import { KEY_CLICK_VARIANTS } from '@/shared/lib/keyClick/keyClick';
import { CandidateBar } from './CandidateBar';
import KeyboardKey from './KeyboardKey';
import LanguageKey from './LanguageKey';
import SpecialKey from './SpecialKey';

const KeyboardRow = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={`relative flex w-full justify-center gap-x-space-3 ${className}`}
    >
      {children}
    </div>
  );
};

const TextKeyboard = ({ onKeyPress }: KeyboardProps) => {
  const keyPressSubject = useConst(() => new Subject<string>());
  const [isUppercase, setIsUppercase] = useState(false);
  const { t } = useTranslate();
  const [isForceEnglish] = useState(false);
  const [openNumberKeyboard, setOpenNumberKeyboard] = useState(false);
  const numberRowRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const { setIsKeyboardAnimating } = useKeyboardStore();
  const keyboardLanguage = useKeyboardStore((s) => s.keyboardLanguage);

  const tKeyboard = (key: string) => t(key, { language: keyboardLanguage });

  const topKeys = isForceEnglish
    ? isUppercase
      ? upperEnglishTopKeys
      : lowerEnglishTopKeys
    : isUppercase
      ? uppercaseTopKeys
      : lowercaseTopKeys;
  const middleKeys = isForceEnglish
    ? isUppercase
      ? upperEnglishMiddleKeys
      : lowerEnglishMiddleKeys
    : isUppercase
      ? uppercaseMiddleKeys
      : lowercaseMiddleKeys;
  const bottomKeys = isForceEnglish
    ? isUppercase
      ? upperEnglishBottomKeys
      : lowerEnglishBottomKeys
    : isUppercase
      ? uppercaseBottomKeys
      : lowercaseBottomKeys;
  const numberKeys = isUppercase ? upperSpecialKeys : upperNumberKeys;

  useEffect(() => {
    const subscription = keyPressSubject.subscribe((key) => {
      onKeyPress(key);
      setIsUppercase(false);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [onKeyPress, keyPressSubject]);

  return (
    <>
      {/* CJK IME 후보 strip — 최상단(숫자패드/키 위), 조합 중일 때만 노출 */}
      <CandidateBar />
      <AnimatePresence>
        {openNumberKeyboard && (
          <motion.div
            ref={numberRowRef}
            className="w-full overflow-hidden"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={KEYBOARD_TRANSITION}
            onAnimationStart={() => {
              setIsKeyboardAnimating(true);
            }}
            onAnimationComplete={() => {
              setIsKeyboardAnimating(false);
            }}
          >
            <div className="pt-space-2 pb-space-1">
              <KeyboardRow>
                {numberKeys.map((key, i) => (
                  <KeyboardKey
                    // biome-ignore lint/suspicious/noArrayIndexKey: shift 토글 시 label만 바뀌어야 하므로 position-stable key 사용
                    key={i}
                    label={key}
                    onKeyPress={(key) => keyPressSubject.next(key)}
                  />
                ))}
              </KeyboardRow>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={keyboardRef}
        className={`flex flex-col items-center gap-space-3 px-space-3 py-space-2`}
      >
        <KeyboardRow>
          {topKeys.map((key, i) => (
            <KeyboardKey
              // biome-ignore lint/suspicious/noArrayIndexKey: shift 토글 시 label만 바뀌어야 하므로 position-stable key 사용
              key={i}
              label={tKeyboard(key)}
              onKeyPress={(key) => keyPressSubject.next(key)}
            />
          ))}
        </KeyboardRow>
        <KeyboardRow>
          {middleKeys.map((key, i) => (
            <KeyboardKey
              // biome-ignore lint/suspicious/noArrayIndexKey: shift 토글 시 label만 바뀌어야 하므로 position-stable key 사용
              key={i}
              label={tKeyboard(key)}
              onKeyPress={(key) => keyPressSubject.next(key)}
            />
          ))}
          {keyboardLanguage === LANGUAGES.JA && !isForceEnglish && (
            <KeyboardKey
              key={'-'}
              label={'-'}
              onKeyPress={(key) => keyPressSubject.next(key)}
            />
          )}
        </KeyboardRow>
        <KeyboardRow className="justify-between">
          <SpecialKey
            content={<ShiftIcon />}
            onKeyPress={() => setIsUppercase((prev) => !prev)}
          />
          {bottomKeys.map((key, i) => (
            <KeyboardKey
              // biome-ignore lint/suspicious/noArrayIndexKey: shift 토글 시 label만 바뀌어야 하므로 position-stable key 사용
              key={i}
              label={tKeyboard(key)}
              onKeyPress={(key) => keyPressSubject.next(key)}
            />
          ))}
          <SpecialKey
            content={<BackspaceIcon />}
            clickVariant={KEY_CLICK_VARIANTS.DELETE}
            onKeyPress={() => keyPressSubject.next(BACKSPACE_KEY)}
          />
        </KeyboardRow>
        <KeyboardRow className="justify-between">
          <LanguageKey />
          <SpecialKey
            width="61px"
            content={'123'}
            onKeyPress={() => {
              setOpenNumberKeyboard((prev) => !prev);
            }}
          />
          <KeyboardKey
            label={SPACE_KEY}
            onKeyPress={(key) => keyPressSubject.next(key)}
            width="194px"
          />
          <SpecialKey
            width="105px"
            content={<ReturnIcon />}
            clickVariant={KEY_CLICK_VARIANTS.RETURN}
            onKeyPress={() => keyPressSubject.next(RETURN_KEY)}
          />
        </KeyboardRow>
      </div>
    </>
  );
};

export default TextKeyboard;
