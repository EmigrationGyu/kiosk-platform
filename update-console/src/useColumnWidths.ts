import { useCallback, useState } from 'react';

/**
 * 세 열의 너비 — 사람이 끌어서 정한다.
 *
 * 고정폭이었을 때 깨진 이유는 화면 크기가 아니라 **내용의 길이**였다: 키오스크 이름과
 * 업장 이름이 길면 320px 에 안 들어가고, 반대로 조합을 볼 때는 가운데가 넓어야 한다.
 * 어느 쪽을 넓힐지는 지금 무슨 일을 하는지에 달렸으므로 사람이 정하는 것이 맞다.
 *
 * 브라우저에 남긴다 — 열 너비는 취향이라 새로고침마다 다시 맞추게 하면 짜증만 난다.
 * (토큰과 달리 새어도 잃을 것이 없다.)
 */

const KEY = 'update-console:cols';

/** 어느 열도 쓸모를 잃을 만큼 좁아지지 않게. 최대는 가운데가 남도록. */
export const COLUMN_LIMITS = {
  left: { min: 240, max: 720 },
  right: { min: 300, max: 820 },
} as const;

export type ColumnSide = keyof typeof COLUMN_LIMITS;

export type ColumnWidths = Record<ColumnSide, number>;

const DEFAULTS: ColumnWidths = { left: 320, right: 380 };

export const clampColumn = (side: ColumnSide, value: number): number =>
  Math.min(
    COLUMN_LIMITS[side].max,
    Math.max(COLUMN_LIMITS[side].min, Math.round(value)),
  );

/** 저장값은 남의 손을 탈 수 있다 — 모양이 아니면 기본값으로 떨어진다. */
function load(): ColumnWidths {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ColumnWidths>;
    return {
      left: clampColumn('left', parsed.left ?? DEFAULTS.left),
      right: clampColumn('right', parsed.right ?? DEFAULTS.right),
    };
  } catch {
    return DEFAULTS;
  }
}

export function useColumnWidths() {
  const [widths, setWidths] = useState<ColumnWidths>(load);

  const set = useCallback((side: ColumnSide, value: number) => {
    setWidths((prev) => {
      const next = { ...prev, [side]: clampColumn(side, value) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // 저장이 막힌 브라우저에서도 이번 세션은 그대로 동작한다.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setWidths(DEFAULTS);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 위와 같다.
    }
  }, []);

  return { widths, set, reset };
}
