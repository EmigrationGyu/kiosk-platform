import ErrorIcon from '@/assets/toast_error.svg?react';
import SuccessIcon from '@/assets/toast_success.svg?react';
import { TOAST_TYPE, type ToastType } from '@/shared/constants/toast';

const iconMap = {
  success: SuccessIcon,
  error: ErrorIcon,
  normal: null,
} as const;

const bgColorMap = {
  success: 'bg-background-success-normal',
  error: 'bg-background-danger-normal',
  normal: 'bg-background-base-elevate',
} as const;

const colorMap = {
  success: 'text-invert-glyph-gray-display',
  error: 'text-invert-glyph-gray-display',
  normal: 'text-glyph-gray-body',
};

const borderMap = {
  success: '',
  error: '',
  normal: 'border-[0.5px] border-solid border-line-outline-stroke',
};

const Toast = ({ text, type }: { text: string; type: ToastType }) => {
  const Icon = iconMap[type];
  const bgColor = bgColorMap[type];
  const color = colorMap[type];
  const border = borderMap[type];

  // normal 토스트는 배경에 opacity 가 있어 뒤가 비침 — 흰색 base 위에 얹어 차폐.
  const content = (
    <div
      className={`w-max px-space-10 py-space-4 rounded-full ${bgColor} ${border}`}
    >
      <div className="flex flex-row items-center stand:gap-space-4 mini:gap-space-2">
        {Icon && (
          <Icon className="stand:w-[20px] stand:h-[20px] mini:w-[16px] mini:h-[16px]" />
        )}
        <span className={`stand:typo-b1-m mini:typo-b3-m ${color}`}>
          {text}
        </span>
      </div>
    </div>
  );

  if (type === TOAST_TYPE.NORMAL) {
    return <div className="rounded-full bg-white">{content}</div>;
  }

  return content;
};

export default Toast;
