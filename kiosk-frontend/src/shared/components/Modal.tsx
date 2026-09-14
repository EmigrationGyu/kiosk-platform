import type { CSSProperties, FC, PropsWithChildren } from 'react';

type ModalProps = PropsWithChildren<{
  className?: string;
  style?: CSSProperties;
}>;

export const Modal: FC<ModalProps> = ({ className, style, children }) => {
  return (
    <div
      className={`inline-block rounded-xl bg-background-base-normal overflow-hidden shadow-modal ${className ?? ''}`}
      style={style}
    >
      {children}
    </div>
  );
};

export default Modal;
