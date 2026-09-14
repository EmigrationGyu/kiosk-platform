import { createStore } from '@/shared/store/storeRegistry';

/**
 * 모달 레이어가 **화면에 있는가**. 모달 스토어(`modalList`)의 애니메이션 반영 지연판이다.
 *
 * `modalList` 를 그대로 보면 안 되는 이유: 스토어 비움은 urgent 커밋인데 라우트 전환은
 * react-router 가 `startTransition` 으로 미루므로, "모달만 사라진" 중간 커밋이 한 번 낀다.
 * 그 커밋을 보고 하단 배너가 올라오기 시작했다가 다음 커밋에 라우트가 바뀌며 다시 내려갔다.
 * dim exit 완료를 신호로 쓰면 라우트 커밋이 항상 먼저라 그 창이 사라진다.
 */
type ModalPresenceMode = 'standard' | 'overlay';

type ModalPresenceStore = {
  isModalPresent: boolean;
  markPresent: (mode: ModalPresenceMode) => void;
  markGone: (mode: ModalPresenceMode) => void;
};

// 모듈 스코프(비공개) — 파생값 하나만 노출한다(globalDisableStore 와 같은 규약).
const presentModes = new Set<ModalPresenceMode>();

const snapshot = () => ({ isModalPresent: presentModes.size > 0 });

export const useModalPresenceStore = createStore<ModalPresenceStore>((set) => ({
  isModalPresent: false,
  markPresent: (mode) => {
    if (!presentModes.has(mode)) {
      presentModes.add(mode);
      set(snapshot());
    }
  },
  markGone: (mode) => {
    if (presentModes.delete(mode)) {
      set(snapshot());
    }
  },
}));

/**
 * 모달 레이어가 화면에서 사라질 때까지. 이미 없으면 즉시 resolve.
 * 화면을 넘기는 쪽(goHome)이 exit 애니메이션과 보조를 맞추는 데 쓴다.
 */
export const waitUntilModalGone = (): Promise<void> =>
  useModalPresenceStore.getState().isModalPresent
    ? new Promise((resolve) => {
        const unsubscribe = useModalPresenceStore.subscribe((state) => {
          if (state.isModalPresent) return;
          unsubscribe();
          resolve();
        });
      })
    : Promise.resolve();
