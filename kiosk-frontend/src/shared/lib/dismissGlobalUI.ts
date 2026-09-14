import type { Z_INDEX } from '@/app/constants/zIndex';
import { useKeyboardStore } from './keyboard/store';
import { useModalStore } from './modal/store';

/**
 * idle 정리 대상 전역 UI의 **단일 출처**. gate(`hasOpenGlobalUI`/`subscribeGlobalUI`)와
 * action(`dismissGlobalUI`)이 모두 여기서 파생되므로 절대 어긋나지 않는다.
 *
 * `Record<keyof typeof Z_INDEX, …>` 로 **모든 전역 레이어를 총망라 강제** — 새 레이어를 Z_INDEX 에
 * 추가하고 여기서 분류(정리 `{…}` or 제외 `null`)하지 않으면 컴파일 에러.
 * (Z_INDEX prop 컨벤션을 우회하는 구현은 막을 수 없어, 이게 최소 안전장치)
 */
type DismissEntry = {
  isOpen: () => boolean;
  clear: () => void;
  subscribe: (cb: () => void) => () => void;
};

const DISMISS_POLICY: Record<keyof typeof Z_INDEX, DismissEntry | null> = {
  modal: {
    isOpen: () => useModalStore.getState().modalList.length > 0,
    clear: () => useModalStore.getState().clearModal(),
    subscribe: (cb) => useModalStore.subscribe(cb),
  },
  keyboard: {
    isOpen: () => useKeyboardStore.getState().keyboardItem.keyboard !== null,
    clear: () => useKeyboardStore.getState().close(),
    subscribe: (cb) => useKeyboardStore.subscribe(cb),
  },
  bottomSheet: null, // 데모에 없음
  overlayModal: null, // modal store 공유 → modal 항목이 커버
  toast: null, // 자가소멸 시스템 피드백 → 제외
  footer: null, // 영구 chrome
  bottomGradient: null, // 결제 시각효과, 플로우 소유
  splash: null, // 부팅/로딩, 플로우 소유
  idleWarning: null, // idle 자기 자신
};

const DISMISSABLE = Object.values(DISMISS_POLICY).filter(
  (e): e is DismissEntry => e !== null,
);

/**
 * 떠 있는 모든 전역 UI(모달·바텀시트·키보드)를 즉시 수거한다.
 * React 밖에서도 호출 가능(`.getState()`) — goHome/idle 리셋 등 명령형 지점에서 쓴다.
 */
export const dismissGlobalUI = () => {
  for (const entry of DISMISSABLE) entry.clear();
};

/** 수거 대상 전역 UI가 하나라도 열려 있는지. idle cleanup 게이트용. */
export const hasOpenGlobalUI = () => DISMISSABLE.some((e) => e.isOpen());

/**
 * 수거 대상 store 변화를 구독(대상 목록은 DISMISS_POLICY 단일 출처).
 * cleanup 파이프라인의 `hasOverlays$` 게이트를 만드는 데 쓴다.
 */
export const subscribeGlobalUI = (cb: () => void): (() => void) => {
  const unsubs = DISMISSABLE.map((e) => e.subscribe(cb));
  return () => {
    for (const u of unsubs) u();
  };
};
