import { useCallback, useState } from 'react';

/**
 * 산출물 설명 — 여러 줄을 살리되 인스펙터가 레이아웃을 밀어내지 않게 자른다.
 *
 * 자르는 것 자체는 옳다(수백 대를 보는 화면에서 설명이 열을 다 먹으면 안 된다). 문제는
 * **잘렸다는 사실이 안 보이는 것**이었다 — 스크롤바가 얇아 "설명이 더 있는데 모르는"
 * 상태가 된다. 그래서 넘칠 때만 아래쪽을 흐린다.
 *
 * 페이드를 CSS 로만 항상 걸면 짧은 설명의 **멀쩡한 마지막 줄**이 흐려지고, 끝까지
 * 스크롤한 뒤에도 계속 흐려 보인다. 둘 다 "더 있다"는 거짓말이라 실제로 재서 켠다.
 */

/** 바닥에 닿았다고 볼 여유 — 반올림·서브픽셀 때문에 0 으로 두면 안 꺼진다. */
const BOTTOM_SLACK = 2;

export function DescriptionBox({ text }: { text: string }) {
  const [more, setMore] = useState(false);

  const check = useCallback((node: HTMLParagraphElement | null) => {
    if (!node) return;
    setMore(
      node.scrollHeight - node.clientHeight - node.scrollTop > BOTTOM_SLACK,
    );
  }, []);

  return (
    <div className={more ? 'desc-box is-more' : 'desc-box'}>
      {/* key 로 다시 마운트시켜 ref 가 새 내용에 대해 다시 잰다 — ref 콜백은 내용이
          바뀌어도 신원이 같으면 다시 불리지 않는다. */}
      <p
        key={text}
        ref={check}
        onScroll={(event) => check(event.currentTarget)}
      >
        {text}
      </p>
    </div>
  );
}
