import { create } from 'zustand';

interface AccessibilityState {
  /** 접근성(음성 안내) 모드. ON 일 때만 A11yNode 가 a11y 전용 음성 재생·포커스 등록을 한다. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

/**
 * 접근성 모드 클라이언트 상태.
 *
 * `createStore`(storeRegistry) 가 아니라 raw `create` 를 쓴다 — goHome 의 `resetAllStores` 에
 * 묶이면 안 되기 때문. 시각장애 사용자가 켠 모드는 홈으로 돌아가도 유지돼야 한다.
 */
export const useAccessibilityStore = create<AccessibilityState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}));
