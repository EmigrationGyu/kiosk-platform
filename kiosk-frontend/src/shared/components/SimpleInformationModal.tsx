import type { A11yKey } from 'kiosk-types';
import type { ComponentProps, ReactNode } from 'react';
import { A11yNode } from '@/shared/a11y';
import { AutoFitText } from '@/shared/components/AutoFitText';
import { Modal } from '@/shared/components/Modal';
import { Button } from '@/shared/ui';

export type SimpleInformationModalButton = Omit<
  ComponentProps<typeof Button>,
  'children'
> & {
  id: string;
  label: ReactNode;
  /** 제공 시 버튼을 a11y 노드로 키잉 (화면별 컨트롤 키). */
  a11yKey?: A11yKey;
};

type SimpleInformationModalProps = {
  title: ReactNode;
  description: ReactNode;
  buttons: SimpleInformationModalButton[];
};

const SimpleInformationModal = ({
  title,
  description,
  buttons,
}: SimpleInformationModalProps) => {
  return (
    <Modal>
      <div className="flex flex-col gap-space-10 w-[280px] px-space-8 pt-space-6 pb-space-7">
        <div className="flex flex-col gap-space-2">
          <span className="typo-h2-b text-glyph-gray-heading">{title}</span>
          <span className="typo-b3-r text-glyph-gray-body">{description}</span>
        </div>
        <div className="flex gap-space-3">
          {buttons.map(({ id, label, className, a11yKey, ...buttonProps }) => {
            const button = (
              <Button
                key={id}
                {...buttonProps}
                className={`flex-1 ${className ?? ''}`.trim()}
              >
                <AutoFitText>{label}</AutoFitText>
              </Button>
            );
            return a11yKey ? (
              <A11yNode key={id} a11yKey={a11yKey}>
                {button}
              </A11yNode>
            ) : (
              button
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default SimpleInformationModal;
