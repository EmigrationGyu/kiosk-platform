import type { ReactNode } from 'react';

type RadialFocusVisualProps = {
  children: ReactNode;
  gradientSize?: number;
  gradientClassName?: string;
  className?: string;
};

/**
 * 중심부터 시작되는 radial gradient 배경 위에 중앙 정렬된 컨텐츠를 배치하는 컴포넌트.
 *
 * @example
 * <RadialFocusVisual>
 *   <ReadCard className="w-[160px] h-[160px]" />
 * </RadialFocusVisual>
 *
 * @example
 * <RadialFocusVisual gradientSize={320} className="h-[275px]">
 *   <CircleIcon glyph={ic_checkmark} />
 * </RadialFocusVisual>
 */
const RadialFocusVisual = ({
  children,
  gradientSize = 240,
  gradientClassName = 'bg-background-accent-focus',
  className,
}: RadialFocusVisualProps) => {
  return (
    <div
      className={`relative flex items-center justify-center ${className ?? ''}`}
    >
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mask-fade-ease-in-out-from-center ${gradientClassName}`}
        style={{ width: gradientSize, height: gradientSize }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default RadialFocusVisual;
