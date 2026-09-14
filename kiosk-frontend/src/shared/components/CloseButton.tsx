import CloseIcon from '@/assets/close_icon.svg?react';
import { Pressable } from '@/shared/ui';

type CloseButtonProps = {
  className?: string;
  onClose: () => void;
  disabled?: boolean;
};

const CloseButton = ({ className, onClose, disabled }: CloseButtonProps) => {
  return (
    <Pressable onPress={onClose} disabled={disabled}>
      <div className={`p-space-3 ${className}`}>
        <CloseIcon />
      </div>
    </Pressable>
  );
};

export default CloseButton;
