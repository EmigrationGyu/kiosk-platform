import { T } from '@tolgee/react';
import type { A11yKey } from 'kiosk-types';
import { A11yNode } from '@/shared/a11y';
import { Button } from '@/shared/ui';

type KeyboardTopButtonProps = {
  labelKey: string;
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  a11yKey: A11yKey;
};

const ACCENT_NORMAL_BUTTON_COLOR = {
  backgroundColor: 'bg-background-accent-normal',
  color: 'text-glyph-accent-white-display',
};

// TODO: 디자인 시스템 색상과 연동된 회색 버튼 렌더링
// @ts-expect-error - 디자인 시스템 색상과 연동된 회색 버튼 렌더링 추후 기능 구현 예정
// biome-ignore lint/correctness/noUnusedVariables: 기획 확정 전까지 보류 — 지우면 색 조합 근거가 사라진다
const KIOSK_GRAY_BUTTON_COLOR = {
  backgroundColor: 'bg-background-accent-elevate',
  color: 'text-glyph-accent-heading',
};

export const KeyboardTopButton = ({
  labelKey,
  onClick,
  isLoading,
  disabled,
  className,
  a11yKey,
}: KeyboardTopButtonProps) => {
  const buttonColor = ACCENT_NORMAL_BUTTON_COLOR.color;
  const buttonBackground = ACCENT_NORMAL_BUTTON_COLOR.backgroundColor;
  return (
    <A11yNode a11yKey={a11yKey}>
      <Button
        kind="accent"
        hierarchy="primary"
        size="medium"
        className={`w-full ${buttonBackground} !rounded-[0px] ${className ?? ''}`}
        onPress={onClick}
        disabled={disabled}
        loading={isLoading}
      >
        <span className={`typo-b1-sb ${buttonColor}`}>
          <T>{labelKey}</T>
        </span>
      </Button>
    </A11yNode>
  );
};
