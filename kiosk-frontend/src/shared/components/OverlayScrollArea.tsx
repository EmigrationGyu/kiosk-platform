import { type ReactNode, useEffect, useRef, useState } from 'react';

/** 썸과 트랙 가장자리 사이 여백 (figma ScrollBar p-space-2) */
const TRACK_INSET_PX = 4;
/** 콘텐츠가 아주 길어도 썸이 시각적으로 사라지지 않게 하는 하한 */
const MIN_THUMB_HEIGHT_PX = 24;
/** 스크롤 활동이 멈춘 뒤 썸이 fade-out 되기까지 */
const HIDE_DELAY_MS = 1_000;

type OverlayScrollAreaProps = {
  /**
   * **바깥 래퍼**에 붙는 클래스 — 이 영역의 *크기·외형* 만 정한다. 래퍼는 이미
   * `relative flex min-h-0 flex-col` 이라 스크롤에 필요한 배선은 갖춰져 있다.
   *
   * children 은 두 단계 아래에 들어가므로 **`flex`·`gap`·`padding` 같은 자식 배치용 클래스를 여기 주면
   * 먹지 않는다** — 배치는 children 을 감싸는 div 에 직접 걸어야 한다.
   */
  className?: string;
  children: ReactNode;
};

/**
 * 콘텐츠 위에 얹히는 오버레이 스크롤바 영역 — figma ScrollBar 스펙(트랙 14px = 여백 4px + 썸 6px).
 * 카탈로그 리스트/장바구니가 공유하는 동일 인스턴스라 한 컴포넌트로 통일한다.
 *
 * Chromium 114+ 에서 overflow:overlay 가 제거되어 네이티브 스크롤바는 반드시 레이아웃 폭을 차지한다 —
 * 디자인처럼 썸이 콘텐츠 위에 겹치려면 네이티브를 숨기고 scrollTop/scrollHeight 파생으로 직접 그리는
 * 수밖에 없다.
 * 콘텐츠 변화 때 나타나고 활동이 멈추면 fade-out 된다(진입 시에도 잠깐
 * 보여줘 스크롤 가능함을 암시).
 */
export function OverlayScrollArea({
  className,
  children,
}: OverlayScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      // 넘치지 않으면 썸 자체를 그리지 않는다
      if (scrollHeight <= clientHeight) {
        setThumb(null);
        return;
      }
      const trackHeight = clientHeight - TRACK_INSET_PX * 2;
      const height = Math.max(
        MIN_THUMB_HEIGHT_PX,
        trackHeight * (clientHeight / scrollHeight),
      );
      const progress = scrollTop / (scrollHeight - clientHeight);
      const top = TRACK_INSET_PX + progress * (trackHeight - height);
      setThumb({ top, height });
    };

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setIsActive(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setIsActive(false), HIDE_DELAY_MS);
    };
    const onScroll = () => {
      update();
      wake();
    };

    update();
    wake();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    // 컨테이너 크기 변화 + 콘텐츠 증감(행 추가/삭제) 모두 썸 재계산·재노출 대상
    const resizeObserver = new ResizeObserver(() => {
      update();
      wake();
    });
    resizeObserver.observe(scrollEl);
    resizeObserver.observe(contentEl);
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    // `flex flex-col min-h-0` 은 **컴포넌트가 스스로 갖는다** — 호출자에게 맡기면 안 된다.
    //
    // 스크롤 div 는 `h-full` 로 높이를 받는데, 퍼센트 높이는 컨테이닝 블록의 height 가
    // auto 면 auto 로 무너진다. 래퍼가 평범한 block 이면 그렇게 되어 스크롤 div 가
    // 콘텐츠만큼 늘어나고, 바깥 flex 가 래퍼 **박스**만 줄이는 바람에 내용이 박스를
    // 삐져나와 아래 형제(스티키 푸터 등) 위에 겹쳐 그려진다.
    // 래퍼가 flex 컨테이너면 스크롤 div 는 flex item 이라 컨테이너의 확정 사용 높이를
    // 받아 제대로 스크롤된다. `min-h-0` 은 래퍼가 콘텐츠 아래로 줄어들 수 있게 한다.
    // (`flex-1` 은 쓰면 안 된다 — 높이가 확정되지 않은 컬럼에서 basis 0 이 높이를 0 으로 붕괴시킨다.)
    <div className={`relative flex min-h-0 flex-col ${className ?? ''}`}>
      <div
        ref={scrollRef}
        className="scrollbar-none h-full w-full overflow-y-auto"
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {thumb && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 right-0 w-[14px] transition-opacity duration-300 ${
            isActive ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            className="absolute right-space-2 w-[6px] rounded-full border border-solid border-line-outline-stroke bg-glyph-gray-caption"
            style={{ top: thumb.top, height: thumb.height }}
          />
        </div>
      )}
    </div>
  );
}
