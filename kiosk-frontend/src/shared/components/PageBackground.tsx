import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PageBackgroundProps {
  /** 배경 이미지 URL */
  image?: string;
  /** 배경 색상 (Tailwind 클래스 또는 CSS 색상) */
  className?: string;
}

/**
 * 페이지 배경을 헤더 영역까지 포함하여 전체 화면에 렌더링합니다.
 * MainLayout의 #page-background 요소에 Portal로 렌더링됩니다.
 */
export const PageBackground = ({
  image,
  className = '',
}: PageBackgroundProps) => {
  // 첫 렌더에서 바로 container를 잡아두면(가능한 환경에서) 1프레임 흰 화면 플래시를 줄일 수 있습니다.
  const [container, setContainer] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    return document.getElementById('page-background');
  });

  // effect 대신 layoutEffect를 써서 paint 전에 portal 대상이 준비되도록 합니다.
  useLayoutEffect(() => {
    if (container) return;
    setContainer(document.getElementById('page-background'));
  }, [container]);

  if (!container) return null;

  return createPortal(
    <div
      className={`w-full h-full bg-cover bg-center bg-no-repeat ${className}`}
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    />,
    container,
  );
};
