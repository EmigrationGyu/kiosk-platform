/**
 * 포커스 가능한 a11y 노드 레지스트리 + DOM 읽기순 네비게이션.
 *
 * A11yNode 가 마운트 시 등록한다. 하드웨어 입력(점자키패드 prev/next/select, 타 담당)이
 * `focusNext/focusPrev/focusByKey` 로 포커스를 옮기면, 포커스 이동에 묶인 onFocus 음성이
 * 자동으로 난다. 단방향 계약: 여기선 `.focus()` 만 호출하고 음성은 A11yNode 가 onFocus 로 처리.
 *
 * 레지스트리는 접근성 모드와 무관하게 채운다 — `A11yNode focusOn`(방향키 이동)이 모드 OFF 에서도
 * 같은 주소 공간을 쓰기 때문. 모드에 따라 갈리는 건 "탭 순서에 편입하느냐"(마운트 시 `ensureFocusable`)
 * 뿐이고, 프로그래매틱 이동은 이동 직전에 대상만 focusable 로 만든다.
 */
import type { A11yKey } from 'kiosk-types';

const nodes = new Map<string, HTMLElement>();

export function registerA11yNode(key: string, el: HTMLElement): void {
  nodes.set(key, el);
}

export function unregisterA11yNode(key: string): void {
  nodes.delete(key);
}

const NATIVELY_FOCUSABLE = /^(?:a|button|input|select|textarea)$/i;

/**
 * 비-focusable 요소를 포커스 순서에 편입(접근성 모드에서만 호출됨).
 * 이미 focusable(tabIndex≥0 · 네이티브 버튼/입력 · VDS Pressable=data-pressable)이면 손대지 않아
 * 이중 탭스톱을 만들지 않는다.
 */
export function ensureFocusable(el: HTMLElement): void {
  if (el.tabIndex >= 0) return;
  if (NATIVELY_FOCUSABLE.test(el.tagName)) return;
  if (el.getAttribute('data-pressable') !== null) return;
  el.tabIndex = 0;
}

/** 등록 노드를 DOM 문서 위치(위→아래·좌→우)로 정렬. 떨어져 나간 노드는 제외. */
function ordered(): HTMLElement[] {
  return [...nodes.values()]
    .filter((el) => el.isConnected)
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
}

/** 프로그래매틱 이동 지점 — 대상이 비-focusable 이면 그 순간 편입한 뒤 포커스. */
function focusElement(el: HTMLElement): void {
  ensureFocusable(el);
  el.focus();
}

/**
 * 등록 키로 포커스 이동. 대상이 없으면(미마운트/떨어져 나감) `false` —
 * 호출부가 브라우저 기본 동작으로 흘려보낼 수 있게 성공 여부를 돌려준다.
 */
export function focusByKey(key: string): boolean {
  const el = nodes.get(key);
  if (!el?.isConnected) return false;
  focusElement(el);
  return true;
}

/** 현재 활성 노드 기준 한 칸 이동(끝에서 순환). delta=+1 다음, -1 이전. */
export function focusStep(delta: 1 | -1): void {
  const list = ordered();
  if (list.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const i = active ? list.indexOf(active) : -1;
  const next =
    i === -1
      ? delta === 1
        ? 0
        : list.length - 1
      : (i + delta + list.length) % list.length;
  const el = list[next];
  if (el) focusElement(el);
}

export const focusNext = (): void => focusStep(1);
export const focusPrev = (): void => focusStep(-1);

/** 방향 닫힌 집합 — `A11yNode focusOn` 의 주소 축. */
export const A11Y_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
} as const;

export type A11yDirection =
  (typeof A11Y_DIRECTIONS)[keyof typeof A11Y_DIRECTIONS];

/** 방향 → 그 방향키를 눌렀을 때 포커스를 받을 노드의 a11yKey. 미지정 방향 = 브라우저 기본. */
export type A11yFocusMap = Partial<Record<A11yDirection, A11yKey>>;

const ARROW_KEY_DIRECTIONS: Record<string, A11yDirection> = {
  ArrowUp: A11Y_DIRECTIONS.UP,
  ArrowDown: A11Y_DIRECTIONS.DOWN,
  ArrowLeft: A11Y_DIRECTIONS.LEFT,
  ArrowRight: A11Y_DIRECTIONS.RIGHT,
};

/** `KeyboardEvent.key` → 방향. 방향키가 아니면 undefined. */
export const directionOfKey = (key: string): A11yDirection | undefined =>
  ARROW_KEY_DIRECTIONS[key];
