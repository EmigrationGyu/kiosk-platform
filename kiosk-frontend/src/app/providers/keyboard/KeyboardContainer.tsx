import { useTolgee } from '@tolgee/react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
} from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConst } from '@/shared/hooks/useConst';
import {
  KEYBOARD_TRANSITION,
  PREVENT_KEYBOARD_CLOSE_ATTR,
  REOPEN_SUPPRESS_MS,
} from '@/shared/lib/keyboard/constants';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';

interface KeyboardContainerProps {
  zIndex: number;
}

const KeyboardContainer = ({ zIndex }: KeyboardContainerProps) => {
  const tolgee = useTolgee();
  const {
    keyboardItem,
    setKeyboardHeight,
    close,
    isKeyboardAnimating,
    suppressReopen,
  } = useKeyboardStore();
  const keyboardLanguage = useKeyboardStore((s) => s.keyboardLanguage);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const y = useMotionValue(0);
  const keyboardContainerRef = useRef<HTMLDivElement>(null);
  const headerSlotRef = useRef<HTMLDivElement>(null);
  // 바깥 영역 터치로 키보드를 닫을 때, 이어지는 click 전파를 제한하기 위한 시간 윈도우(ms)
  // (disabled 버튼처럼 click 자체가 발생하지 않는 케이스에서도 다음 사용자 클릭을 영구 차단하지 않도록)
  const blockClickUntilRef = useRef(0);
  const closeAfterClickRef = useRef(false);
  const observer = useConst(
    () =>
      new ResizeObserver((entries) => {
        for (const entry of entries) {
          // contentRect는 border를 제외하므로, 실제 렌더링 높이를 기준으로 저장
          setKeyboardHeight(
            (entry.target as HTMLElement).getBoundingClientRect().height,
          );
        }
      }),
  );

  useEffect(() => {
    // tolgee.t의 language 옵션은 "그 언어 리소스가 이미 로드되어 있을 때"만 제대로 동작함.
    // 키보드는 전역 tolgee language를 바꾸지 않으므로, keyboardLanguage에 대한 리소스를 선로드한다.
    tolgee
      .loadRequired({ language: keyboardLanguage, useCache: true })
      .catch(() => null);
  }, [keyboardLanguage, tolgee]);

  useEffect(() => {
    if (!keyboardContainerRef.current) return;
    if (isKeyboardAnimating) {
      observer.observe(keyboardContainerRef.current);
    } else {
      observer.disconnect();
    }
    return () => {
      observer.disconnect();
    };
  }, [isKeyboardAnimating, observer]);

  useMotionValueEvent(y, 'change', (value) => {
    if (!keyboardContainerRef.current) return;
    // framer-motion이 '100%' → 0 으로 애니메이션하므로,
    // value는 string('80%') 또는 number(80)일 수 있음
    const numeric = typeof value === 'string' ? parseFloat(value) : value;
    const progress = 1 - numeric / 100; // 0 ~ 1
    const currentHeight =
      keyboardContainerRef.current?.getBoundingClientRect().height * progress;

    setKeyboardHeight(currentHeight);
  });

  const keyboardRoot =
    (typeof document !== 'undefined' &&
      document.getElementById('keyboard-root')) ||
    document.body;

  useEffect(() => {
    if (!element) return;

    const isDisabledInteractive = (el: Element) => {
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if (el.hasAttribute('disabled')) return true;

      // role="button" 등 일반 Element에서도 'disabled' 속성은 타입상 없을 수 있어 보호적으로 체크
      const maybeDisabled = (el as unknown as { disabled?: boolean }).disabled;
      return maybeDisabled === true;
    };

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement;
      // Footer 영역 클릭 시 키보드 닫지 않음
      if (target.closest(`[${PREVENT_KEYBOARD_CLOSE_ATTR}="true"]`)) {
        return;
      }

      // 텍스트 입력 영역은 포커스 이동/키보드 유지가 자연스러우므로 닫지 않음
      if (target.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }

      if (element && !element.contains(target as Node)) {
        // "버튼인 경우"만 클릭을 살리고, 버튼이 아닌 onClick 영역은 키보드만 닫는다.
        // (DX/UX 관점에서 '버튼 컴포넌트/태그' 중심으로 규칙을 단순하게 유지)
        const interactiveEl = target.closest('button, a[href]');

        // 버튼류는 "클릭 수행 후 키보드 닫기"가 자연스러움(2번 탭 방지)
        // - 단, disabled 버튼은 비-버튼 영역처럼 취급(클릭도 안 되니 키보드만 닫기)
        if (interactiveEl && !isDisabledInteractive(interactiveEl)) {
          closeAfterClickRef.current = true;
          return;
        }

        // 그 외 바깥 영역(또는 disabled 버튼)은 키보드만 닫고, 이어지는 click 전파는
        // 막아 의도치 않은 액션을 방지한다.
        // (Pressable 의 press/hover dim 은 CSS :active/:hover 라 JS 이벤트로는 못 막는다 —
        //  터치 키오스크의 sticky :hover dim 잔상은 index.css 의 전역 오버라이드로 처리.)
        blockClickUntilRef.current = Date.now() + 500;
        // 닫힘 리플로우(모달이 내려옴) 도중 input 이 손가락 밑으로 미끄러져 들어와
        // release 시 재-focus → 재오픈되는 레이스를 막는다.
        suppressReopen(REOPEN_SUPPRESS_MS);
        close();
      }
    };

    const handleDocumentClick = (event: MouseEvent) => {
      // 바깥 영역 탭으로 키보드를 닫았으면, 이어지는 click 전파를 차단
      if (Date.now() <= blockClickUntilRef.current) {
        blockClickUntilRef.current = 0;
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      // 버튼류 탭은 click 처리가 끝난 뒤(이벤트 루프 다음) 키보드만 닫기
      if (closeAfterClickRef.current) {
        closeAfterClickRef.current = false;
        setTimeout(() => {
          close();
        }, 0);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick, true);
    document.addEventListener('touchstart', handleOutsideClick, true);
    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, true);
      document.removeEventListener('click', handleDocumentClick, true);
      observer.disconnect();
    };
  }, [element, close, observer, suppressReopen]);

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-safe-bottom-kiosk flex flex-col items-center justify-center"
      style={{ zIndex }}
    >
      <AnimatePresence
        onExitComplete={() => {
          setKeyboardHeight(0);
        }}
      >
        {keyboardItem.keyboard && (
          <motion.div
            style={{ y }}
            key="keyboard-container"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={KEYBOARD_TRANSITION}
            className="pointer-events-auto w-full bg-white"
            // 키(Pressable) pointerdown 의 기본동작(focus 이동)을 막아, 키 입력 중
            // 소유 input 의 focus 가 풀리지 않게 한다. capture 라 Pressable 이
            // stopPropagation 해도 먼저 실행되고, preventDefault 라 onPress(pointerup)는
            // 그대로 발화한다. 입력값은 어차피 onKeyPress→onChange 로 들어가므로 무관.
            onPointerDownCapture={(e) => e.preventDefault()}
            ref={(el) => {
              setElement(el);
            }}
          >
            <div className="bg-background-gray-elevate">
              {keyboardItem.headerSlot && (
                <div className="w-full" ref={headerSlotRef}>
                  {keyboardItem.headerSlot}
                </div>
              )}
              <div
                className="flex flex-col items-center justify-center w-full border-solid border-t-line-outline-stroke border-t-[0.5px]"
                ref={keyboardContainerRef}
              >
                <keyboardItem.keyboard {...keyboardItem.props} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    keyboardRoot,
  );
};

export default KeyboardContainer;
