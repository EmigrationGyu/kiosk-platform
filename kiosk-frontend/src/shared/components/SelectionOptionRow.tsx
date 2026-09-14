import type { ReactNode } from 'react';
import ChevronRightIcon from '@/assets/chevron_right.svg?react';
import { Pressable } from '@/shared/ui';

type SelectionOptionRowProps = {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  titleClassName: string;
  description: string;
  descriptionClassName: string;
  onClick: () => void;
};

const SelectionOptionRow = ({
  icon,
  iconClassName,
  title,
  titleClassName,
  description,
  descriptionClassName,
  onClick,
}: SelectionOptionRowProps) => {
  return (
    <Pressable onPress={onClick}>
      <div className="flex flex-row items-center gap-space-5 py-space-4">
        <div className={iconClassName}>{icon}</div>
        <div className="flex flex-col flex-1">
          <span className={titleClassName}>{title}</span>
          <span className={descriptionClassName}>{description}</span>
        </div>
        <ChevronRightIcon />
      </div>
    </Pressable>
  );
};

export default SelectionOptionRow;
