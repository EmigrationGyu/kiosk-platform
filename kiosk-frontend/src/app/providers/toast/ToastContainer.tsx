import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore } from '@/shared/lib/toast/store';
import Toast from './Toast';

// 토스트 간격 및 레이아웃
const TOAST_SPACING = 8; // gap between toasts (px)
const TOP_SPACER_PX = 64; // .h-16

// 토스트 애니메이션 - Tween 설정 (퇴장 슬라이드)
const EXIT_TWEEN_CONFIG = {
  DURATION: 0.25, // 애니메이션 시간 (초)
  EASE: 'easeInOut' as const,
} as const;

// 토스트 애니메이션 - Spring 설정
const LAYOUT_SPRING_CONFIG = {
  STIFFNESS: 500, // 탄성 강도
  DAMPING: 35, // 감쇠
  DELAY: 0, // 레이아웃 이동 지연 없음
} as const;

interface ToastContainerProps {
  zIndex: number;
}

const ToastContainer = ({ zIndex }: ToastContainerProps) => {
  const toastList = useToastStore((s) => s.toastList);
  const [measuredToastHeight, setMeasuredToastHeight] = useState<number>(56); // 대략값, 최초 토스트 렌더 시 갱신
  const [toastHeights, setToastHeights] = useState<
    Record<string | number, number>
  >({});

  const getToastHeight = (id: string | number) => {
    const h = toastHeights[id];
    return typeof h === 'number' && h > 0 ? h : measuredToastHeight;
  };

  const toastRoot =
    (typeof document !== 'undefined' &&
      document.getElementById('toast-root')) ||
    document.body;

  // 외부 래퍼 높이 variants (marginBottom 애니메이션 제거, gap 사용)
  const wrapperVariants: Variants = {
    initial: (offsetY: number) => ({
      // 계산된 누적 오프셋만큼 위로 이동해 "하단"이 화면 상단과 맞닿도록
      y: -offsetY,
    }),
    animate: {
      y: 0, // 원래 위치로 (spacer 아래)
      transition: {
        type: 'spring',
        stiffness: LAYOUT_SPRING_CONFIG.STIFFNESS,
        damping: LAYOUT_SPRING_CONFIG.DAMPING,
      },
    },
    exit: (offsetY: number) => ({
      // 종료 시에도 동일한 위치로
      y: -offsetY,
      transition: {
        y: {
          type: 'tween',
          duration: EXIT_TWEEN_CONFIG.DURATION,
          ease: EXIT_TWEEN_CONFIG.EASE,
        },
      },
    }),
  };

  return createPortal(
    <div
      className="fixed top-0 left-0 right-0 flex flex-col items-center px-4 pointer-events-none overflow-visible"
      style={{ gap: TOAST_SPACING, zIndex }}
    >
      <div className="h-16" />
      <AnimatePresence>
        {toastList.map((toast, index) => {
          // 누적 오프셋 계산: spacer + (이전 토스트 높이+간격) 합 + 현재 토스트 높이
          const prevOffset =
            TOP_SPACER_PX +
            toastList.slice(0, index).reduce((acc, t) => {
              return acc + getToastHeight(t.id) + TOAST_SPACING;
            }, 0);
          const currentHeight = getToastHeight(toast.id);
          const offsetY = prevOffset + currentHeight;

          return (
            <motion.div
              key={toast.id}
              layout
              variants={wrapperVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              custom={offsetY}
              transition={{
                layout: {
                  type: 'spring',
                  stiffness: LAYOUT_SPRING_CONFIG.STIFFNESS,
                  damping: LAYOUT_SPRING_CONFIG.DAMPING,
                  delay: LAYOUT_SPRING_CONFIG.DELAY,
                },
              }}
            >
              <motion.div
                className="pointer-events-auto"
                // 각 토스트의 실제 높이를 측정해 저장
                ref={(el) => {
                  if (el) {
                    const h = el.getBoundingClientRect().height;
                    if (h > 0) {
                      setToastHeights((prev) => {
                        const prevH = prev[toast.id];
                        if (
                          typeof prevH === 'number' &&
                          Math.abs(prevH - h) < 0.5
                        ) {
                          return prev;
                        }
                        return { ...prev, [toast.id]: h };
                      });
                      // 공통 대체값(미측정 항목 fallback)을 위해 대표 높이도 업데이트
                      if (Math.abs(measuredToastHeight - h) > 0.5) {
                        setMeasuredToastHeight(h);
                      }
                    }
                  }
                }}
              >
                <Toast text={toast.text} type={toast.type} />
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    toastRoot,
  );
};

export default ToastContainer;
