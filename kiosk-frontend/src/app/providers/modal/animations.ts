import type { Transition, Variant } from 'motion/react';

export const modalContentVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
} as const satisfies Record<string, Variant>;

export const MODAL_CONTENT_DURATION_S = 0.25;
export const MODAL_CONTENT_DURATION_MS = MODAL_CONTENT_DURATION_S * 1000;

export const modalContentTransition: Transition = {
  duration: MODAL_CONTENT_DURATION_S,
  ease: 'easeOut',
};
