import CloseButton from '../CloseButton';

export const CloseButtonModalHeader = ({
  onClose,
  disabled,
}: {
  onClose: () => void;
  disabled?: boolean;
}) => {
  return (
    <div className="py-space-3 pr-space-5 flex justify-end">
      <CloseButton onClose={onClose} disabled={disabled} />
    </div>
  );
};
