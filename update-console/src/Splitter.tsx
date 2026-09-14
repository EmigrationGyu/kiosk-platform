import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { COLUMN_LIMITS, type ColumnSide } from './useColumnWidths';

/**
 * 열 사이의 손잡이.
 *
 * 포인터 캡처를 쓰는 이유: 빠르게 끌면 커서가 손잡이 밖으로 나가고, 그러면 이동
 * 이벤트가 다른 요소로 가서 드래그가 중간에 끊긴다. 캡처하면 놓을 때까지 이 요소가 받는다.
 *
 * 왼쪽 손잡이는 컨테이너 왼쪽에서의 거리가, 오른쪽 손잡이는 오른쪽에서의 거리가 곧
 * 그 열의 너비다 — 가운데는 남는 자리를 먹으므로 계산에 들어가지 않는다.
 *
 * 키보드로도 움직인다. 5px 짜리 띠를 정확히 집는 것은 트랙패드에서 꽤 성가시고, 그
 * 대안이 방향키 하나면 충분하다.
 */

/** 방향키 한 번의 걸음. 눈에 보일 만큼 크되 한 번에 지나치지 않을 만큼. */
const STEP = 16;

export function Splitter({
  side,
  width,
  onResize,
  onReset,
}: {
  side: ColumnSide;
  width: number;
  onResize: (side: ColumnSide, width: number) => void;
  /** 더블클릭 = 기본 너비로. 잘못 끌어놓고 못 돌아오는 것을 막는 탈출구다. */
  onReset: () => void;
}) {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cols = event.currentTarget.parentElement;
    if (!cols) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent) => {
      const box = cols.getBoundingClientRect();
      onResize(
        side,
        side === 'left' ? moved.clientX - box.left : box.right - moved.clientX,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 왼쪽 손잡이는 오른쪽으로 갈수록 넓어지고, 오른쪽 손잡이는 그 반대다.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const toward = side === 'left' ? 1 : -1;
    if (event.key === 'ArrowLeft') onResize(side, width - STEP * toward);
    else if (event.key === 'ArrowRight') onResize(side, width + STEP * toward);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="splitter"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-label="열 너비 조절"
      aria-valuenow={width}
      aria-valuemin={COLUMN_LIMITS[side].min}
      aria-valuemax={COLUMN_LIMITS[side].max}
    />
  );
}
