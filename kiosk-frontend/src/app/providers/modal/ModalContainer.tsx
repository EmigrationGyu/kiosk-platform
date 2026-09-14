import { createPortal } from 'react-dom';
import KeyboardSpacer from '@/app/layouts/KeyboardSpacer';
import ModalRenderer from './ModalRenderer';
import { MODAL_CONTAINER_MAP } from './registry';
import { useModalContainer } from './useModalContainer';

interface ModalContainerProps {
  zIndex: number;
}

const ModalContainer = ({ zIndex }: ModalContainerProps) => {
  const modalContainerProps = useModalContainer(MODAL_CONTAINER_MAP.STANDARD);

  const modalRoot =
    (typeof document !== 'undefined' &&
      document.getElementById('modal-root')) ||
    document.body;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col pointer-events-none"
      style={{ zIndex }}
    >
      <ModalRenderer {...modalContainerProps} />
      <KeyboardSpacer />
    </div>,
    modalRoot,
  );
};

export default ModalContainer;
