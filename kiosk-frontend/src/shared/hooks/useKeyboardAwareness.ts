import { KEYBOARD_TRANSITION } from '@/shared/lib/keyboard/constants';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';

/**
 * 키보드 높이 변화에 반응하는 애니메이션 props를 제공하는 훅
 */
export const useKeyboardAwareness = () => {
  const keyboardHeight = useKeyboardStore((state) => state.keyboardHeight);
  const isKeyboardAnimating = useKeyboardStore(
    (state) => state.isKeyboardAnimating,
  );

  return {
    /** 현재 키보드 높이 (px) */
    keyboardHeight,
    /** 애니메이션 트랜지션 설정 (동기화용) */
    transition: KEYBOARD_TRANSITION,
    /** 키보드 애니메이션 상태, 메인 콘텐츠 영역의 애니메이션을 제어하는데 사용됩니다. */
    isKeyboardAnimating,

    /**
     * 1. 패딩이 늘어나면서 콘텐츠를 위로 밀어올리는 방식
     * (주로 ScrollView나 전체 페이지 레이아웃에서 사용)
     */
    animateMargin: {
      animate: { marginBottom: keyboardHeight },
      transition: KEYBOARD_TRANSITION,
    },

    /**
     * 2. 높이 자체가 줄어드는 방식
     * (Flex Layout에서 남은 공간을 채우는 요소 등에 사용)
     *
     * @example <motion.div {...animateHeight('100vh')} />
     * @example <motion.div {...animateHeight(500)} />
     */
    animateHeight: (baseHeight: string | number = '100%') => ({
      animate: {
        height:
          typeof baseHeight === 'number'
            ? baseHeight - keyboardHeight
            : `calc(${baseHeight} - ${keyboardHeight}px)`,
      },
      transition: KEYBOARD_TRANSITION,
    }),
  };
};
