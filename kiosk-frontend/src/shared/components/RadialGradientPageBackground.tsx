import type { ReactNode } from 'react';

const RadialGradientPageBackground = ({
  children,
}: {
  children: ReactNode;
}) => {
  return (
    <div className="relative flex items-center justify-center w-full h-full overflow-hidden">
      {children}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[640px] bg-background-accent-focus mask-fade-ease-in-out-from-center pointer-events-none" />
    </div>
  );
};

export default RadialGradientPageBackground;
