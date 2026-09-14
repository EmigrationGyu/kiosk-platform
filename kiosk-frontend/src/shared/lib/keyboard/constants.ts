import type { Transition } from 'motion/react';

export const KEYBOARD_TRANSITION: Transition = {
  type: 'keyframes',
  duration: 0.3,
  ease: 'easeInOut',
};

export const SAFE_BOTTOM_KIOSK = 52;

export const PREVENT_KEYBOARD_CLOSE_ATTR = 'data-prevent-keyboard-close';

/**
 * 바깥 탭으로 키보드를 닫을 때, 닫힘 애니메이션(KEYBOARD_TRANSITION, 0.3s) 동안
 * 모달이 아래로 리플로우되며 input 이 손가락 밑으로 미끄러져 들어와, release 시
 * 재-focus → 키보드 재오픈되는 레이스를 막기 위한 억제 시간(ms). 애니메이션보다 약간 길게.
 */
export const REOPEN_SUPPRESS_MS = 350;
