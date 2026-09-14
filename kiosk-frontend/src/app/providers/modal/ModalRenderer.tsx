import { AnimatePresence, motion } from 'motion/react';
import type { ComponentType } from 'react';
import { PREVENT_KEYBOARD_CLOSE_ATTR } from '@/shared/lib/keyboard/constants';
import { ModalFlowBoundary } from '@/shared/lib/modal/ModalFlowProvider';
import type { ModalItem } from '@/shared/lib/modal/types';
import { IconButton } from '@/shared/ui';
import { ic_xmark } from '@/shared/ui/icons';
import {
  MODAL_CONTENT_DURATION_S,
  modalContentTransition,
  modalContentVariants,
} from './animations';
import { MODAL_MAP } from './registry';

type ModalRendererProps = {
  topModal: ModalItem | undefined;
  hasModal: boolean;
  handleOverlayClick: () => void;
  handleCloseButtonClick: () => void;
  handleExitComplete: () => void;
};

const ModalRenderer = ({
  topModal,
  hasModal,
  handleOverlayClick,
  handleCloseButtonClick,
  handleExitComplete,
}: ModalRendererProps) => (
  <div className="relative flex-1 w-full">
    {/* 오버레이*/}
    <AnimatePresence onExitComplete={handleExitComplete}>
      {hasModal && (
        <motion.div
          key="modal-overlay"
          className="absolute inset-0 bg-effect-dim-modal pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{
            opacity: 0,
            transition: { duration: MODAL_CONTENT_DURATION_S },
          }}
          transition={{ duration: 0.2 }}
          onClick={handleOverlayClick}
          {...{ [PREVENT_KEYBOARD_CLOSE_ATTR]: 'true' }}
        />
      )}
    </AnimatePresence>

    {/* 닫기 버튼 */}
    <AnimatePresence>
      {topModal?.options?.showCloseButton && (
        <motion.div
          key="modal-close-button"
          className="absolute top-[calc(var(--safe-top-kiosk)+6px)] right-[10px] pointer-events-auto z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <IconButton
            icon={ic_xmark}
            kind="common"
            hierarchy="naked"
            className="backdrop-blur-none w-[36px] h-[36px]"
            style={{ color: '#DFEFFF' }}
            onPress={handleCloseButtonClick}
          />
        </motion.div>
      )}
    </AnimatePresence>

    {/* 모달 콘텐츠 */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <AnimatePresence mode="wait">
        {topModal && (
          <ModalFlowBoundary flowToken={topModal.options?.flowToken}>
            <motion.div
              key={topModal.modalType}
              className="pointer-events-auto relative"
              variants={modalContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={modalContentTransition}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const Component = MODAL_MAP[topModal.modalType];
                if ('props' in topModal && topModal.props) {
                  const Comp = Component as ComponentType<
                    typeof topModal.props
                  >;
                  return <Comp {...topModal.props} />;
                } else {
                  const Comp = Component as ComponentType<object>;
                  return <Comp />;
                }
              })()}
            </motion.div>
          </ModalFlowBoundary>
        )}
      </AnimatePresence>
    </div>
  </div>
);

export default ModalRenderer;
