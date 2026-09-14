import { useLayoutEffect, useRef } from 'react';

// 이분 탐색의 하한 경계(px). 의미 있는 "최소 폰트"가 아니라 폰트가 0/음수로 가지
// 않게 막는 안전선일 뿐이다. 키오스크는 450px 논리폭 + zoomFactor 로 물리 화면에서
// 확대되므로, 논리 폰트가 작아도 읽힌다 → 별도의 가독성 하한을 두지 않는다.
const SEARCH_FLOOR_PX = 1;

type AutoFitTextProps = {
  children: React.ReactNode;
  /** 이분 탐색 수렴 정밀도(px). 작을수록 정밀·반복 ↑. 기본 0.5 */
  precision?: number;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>;

/**
 * 실제로 클리핑하는 조상(overflow ≠ visible — 보통 Button/Segment label)을 찾아,
 * 그 박스가 콘텐츠로 넘치면 텍스트 폰트를 넘치지 않는 최대 크기까지 줄인다.
 *
 * 왜 직속 부모가 아니라 "클리핑 조상"을 보는가:
 * - VDS Button 은 children 을 내부 `<div class="flex items-center">`(min-width 없음)로
 *   한 번 더 감싼다. 이런 중간 컨테이너는 콘텐츠 크기로 shrink-wrap 되어 버튼 폭을
 *   반영하지 못한다. 직속 부모/자기 자신의 폭으로 재면 "안 넘침"으로 오판한다.
 * - 반면 실제 폭 제약 + overflow:hidden 을 가진 조상(버튼/라벨)의 scrollWidth vs
 *   clientWidth 는 "아이콘+텍스트+패딩 전체가 그 박스를 넘치는가"를 직접 알려주므로
 *   중간 div 구조와 무관하게 정확하다.
 *
 * 자식 텍스트는 `display:block`(inline baseline 어긋남 없음) + `white-space:nowrap`.
 * overflow 는 건드리지 않아(visible) 넘친 폭이 클리핑 조상의 scrollWidth 에 반영된다.
 * children 으로 raw string 과 <T> 둘 다 받는다(둘 다 ReactNode).
 */
export const AutoFitText = ({
  children,
  precision = 0.5,
  className,
  ...rest
}: AutoFitTextProps) => {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 실제로 클리핑하는(=폭을 제약하는) 가장 가까운 조상.
    const getClipBox = (): HTMLElement => {
      let a = el.parentElement;
      while (a && a !== document.body) {
        if (getComputedStyle(a).overflowX !== 'visible') return a;
        a = a.parentElement;
      }
      return el.parentElement ?? el;
    };
    const clip = getClipBox();

    // 맞음(fit)의 정의: el 자신도, 클리핑 조상도 넘치지 않음.
    // - el(display:block)은 부모의 content-box 를 채우므로 el.scrollWidth>el.clientWidth
    //   는 "패딩 안쪽을 넘침"을 뜻한다 → 패딩 존중(부모가 직접 제약하는 세그먼트 등).
    // - clip 은 중간 div 가 콘텐츠로 늘어나 el 이 안 눌리는 경우(메인 등)를 잡는다.
    // 둘 다 fit 일 때만 멈추므로, fit 케이스를 과축소하지 않는다.
    const fits = () =>
      el.scrollWidth <= el.clientWidth && clip.scrollWidth <= clip.clientWidth;

    const fit = () => {
      // 기준 폰트로 복귀시킨 뒤 측정. 안 넘치면 그대로 둔다(= 폰트 미변경).
      el.style.fontSize = '';
      if (fits()) return;

      // 넘침 → [floor, base] 에서 들어가는 최대 폰트를 이분 탐색.
      const base = Number.parseFloat(getComputedStyle(el).fontSize);
      let lo = SEARCH_FLOOR_PX;
      let hi = base;
      while (hi - lo > precision) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${lo}px`;
    };

    fit();

    // 클리핑 박스 폭(=실제 가용 폭) 변화 시에만 재측정. 폰트 축소는 박스 폭을 바꾸지
    // 않으므로(고정폭 버튼/라벨) 루프가 생기지 않는다.
    let lastWidth = clip.clientWidth;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width === lastWidth) return;
      lastWidth = width;
      fit();
    });
    ro.observe(clip);

    // <T> 비동기 로드/언어 변경으로 텍스트가 바뀌면 재측정.
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [precision]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap' }}
      {...rest}
    >
      {children}
    </span>
  );
};
