import { useTranslate } from '@tolgee/react';
import type { ImeCause } from 'kiosk-types';
import { AnimatePresence, motion } from 'motion/react';
import { KEYBOARD_TRANSITION } from '@/shared/lib/keyboard/constants';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';
import { playKeyClick } from '@/shared/lib/keyClick/keyClick';
import { Pressable } from '@/shared/ui';

// 원인 → 문구. `satisfies` 로 닫아 두면 새 cause 가 생겼을 때 문구를 빠뜨릴 수 없다.
const IME_UNAVAILABLE_KEY = {
  ENGINE_NOT_READY: 'ime.unavailable.engine',
  SCHEMA_UNAVAILABLE: 'ime.unavailable.schema',
  UNKNOWN: 'ime.unavailable.unknown',
} satisfies Record<ImeCause, string>;

/**
 * CJK IME 후보 strip (피그마 "auto complete", node 3643:59406).
 * 키보드 최상단(키 rows 위)에 위치하며, 조합 중일 때만 숫자패드와 동일한 height 애니메이션으로 나타난다.
 * 후보는 keyboardStore.imeComposition 을 구독해 렌더하고, 탭 시 imeSelectCandidate 로 확정/전진한다.
 *
 * 엔진이 없는 언어(배포에 자산이 안 깔린 경우)는 **같은 자리**에 한 줄로 그 사실을 적는다.
 * 실패를 말없이 삼키면 손님에겐 "키보드가 고장난 것"으로 보이고, 키마다 토스트를 띄우면
 * 타이핑이 토스트에 묻힌다. 원인 식별자만 올라오므로 문구는 프론트가 고른다.
 */
export const CandidateBar = () => {
  const composition = useKeyboardStore((s) => s.imeComposition);
  const unavailable = useKeyboardStore((s) => s.imeUnavailable);
  const { t } = useTranslate();
  const selectCandidate = useKeyboardStore((s) => s.imeSelectCandidate);
  const setIsKeyboardAnimating = useKeyboardStore(
    (s) => s.setIsKeyboardAnimating,
  );

  const hasCandidates =
    composition.composing && composition.candidates.length > 0;
  const show = hasCandidates || unavailable !== null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="w-full overflow-hidden"
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0 }}
          transition={KEYBOARD_TRANSITION}
          onAnimationStart={() => setIsKeyboardAnimating(true)}
          onAnimationComplete={() => setIsKeyboardAnimating(false)}
        >
          <div className="flex h-[48px] w-full items-center gap-[4px] overflow-x-auto rounded-[10px] bg-background-base-elevate p-[4px]">
            {!hasCandidates && unavailable !== null && (
              <span className="typo-b3-r px-[12px] text-glyph-gray-description">
                {t(IME_UNAVAILABLE_KEY[unavailable])}
              </span>
            )}
            {composition.candidates.map((candidate, index) => {
              const isHighlighted = index === composition.highlightedIndex;
              return (
                <Pressable
                  // biome-ignore lint/suspicious/noArrayIndexKey: 후보는 런타임 텍스트라 안정 key 가 없다 — index+text 로 position-stable
                  key={`${index}-${candidate.text}`}
                  className={`flex h-full shrink-0 items-center justify-center rounded-[8px] px-[12px] ${
                    isHighlighted ? 'bg-background-base-elevate' : ''
                  }`}
                  onPress={() => {
                    playKeyClick();
                    void selectCandidate(index);
                  }}
                >
                  <span
                    className={`typo-b1-m whitespace-nowrap ${
                      isHighlighted
                        ? 'text-glyph-gray-body'
                        : 'text-glyph-gray-description'
                    }`}
                  >
                    {candidate.text}
                  </span>
                </Pressable>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
