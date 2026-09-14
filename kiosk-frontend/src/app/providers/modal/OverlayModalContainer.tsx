import { createPortal } from 'react-dom';
import { PREVENT_KEYBOARD_CLOSE_ATTR } from '@/shared/lib/keyboard/constants';
import ModalRenderer from './ModalRenderer';
import { MODAL_CONTAINER_MAP } from './registry';
import { useModalContainer } from './useModalContainer';

interface OverlayModalContainerProps {
  zIndex: number;
}

const OverlayModalContainer = ({ zIndex }: OverlayModalContainerProps) => {
  const modalContainerProps = useModalContainer(MODAL_CONTAINER_MAP.OVERLAY);

  const modalRoot =
    (typeof document !== 'undefined' &&
      document.getElementById('modal-root')) ||
    document.body;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col pointer-events-none"
      style={{ zIndex }}
      {...{ [PREVENT_KEYBOARD_CLOSE_ATTR]: 'true' }}
    >
      <ModalRenderer {...modalContainerProps} />
    </div>,
    modalRoot,
  );
};

export default OverlayModalContainer;
