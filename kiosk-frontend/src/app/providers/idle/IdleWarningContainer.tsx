import { AnimatePresence, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { useIdleWarningDeadline } from '@/shared/store/idleStore';
import IdleWarningOverlay from './IdleWarningOverlay';

interface IdleWarningContainerProps {
  zIndex: number;
}

/**
 * 전역 idle 경고 전용 컨테이너. **모달 스토어를 쓰지 않는다** — idleStore.warningDeadline 만 구독해
 * 자체 포털·최상위 z-index 로 뜬다. 그래서:
 *  - 밑에 떠 있는 모달/바텀시트/키보드를 언마운트하지 않음 → 로컬 state·flowToken 무손상, 터치 시 그대로 복원
 *  - 어떤 레이어(overlayModal·bottomGradient·splash)보다도 위 → 항상 최상위
 *
 * dim 배경은 pointer-events 를 먹어 밑 화면 조작을 막지만, **배경 탭으로는 경고가 안 꺼진다** —
 * 해제는 오직 "계속 사용" 버튼(resume) 또는 유예 만료(자동 홈). (경고 중 ambient 활동은 파이프라인이 무시)
 */
const IdleWarningContainer = ({ zIndex }: IdleWarningContainerProps) => {
  const deadline = useIdleWarningDeadline();

  return createPortal(
    <AnimatePresence>
      {deadline !== null && (
        <motion.div
          key="idle-warning"
          className="fixed inset-0 flex items-center justify-center bg-effect-dim-modal pointer-events-auto"
          style={{ zIndex }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <IdleWarningOverlay />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default IdleWarningContainer;
