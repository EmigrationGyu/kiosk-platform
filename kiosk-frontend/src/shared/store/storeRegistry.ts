import type { StateCreator, StoreApi } from 'zustand';
import { create } from 'zustand';

// Store의 초기 상태를 저장하는 타입
type StoreWithReset = {
  reset: () => void;
};

// Registry에 등록된 모든 store들
const storeRegistry = new Set<StoreApi<any>>();
const initialStates = new WeakMap<StoreApi<any>, any>();

/**
 * Zustand store를 생성하고 자동으로 registry에 등록합니다.
 * 모든 store는 reset() 함수를 갖게 되며, resetAllStores()로 일괄 초기화 가능합니다.
 */
export function createStore<T extends object>(stateCreator: StateCreator<T>) {
  // 초기 상태를 캡처하기 위한 wrapper
  const store = create<T & StoreWithReset>((set, get, api) => {
    const initialState = stateCreator(set, get, api);

    // 초기 상태 저장 (reset을 위해)
    const stateWithoutReset = { ...initialState };

    return {
      ...initialState,
      reset: () => {
        set(stateWithoutReset as any);
      },
    };
  });

  // Store를 registry에 등록
  storeRegistry.add(store as any);

  // 초기 상태 저장
  const state = (store as any).getState();
  const initialStateSnapshot = { ...state };
  delete initialStateSnapshot.reset;
  initialStates.set(store as any, initialStateSnapshot);

  return store;
}

/**
 * Registry에 등록된 모든 store를 초기 상태로 리셋합니다.
 */
export function resetAllStores() {
  storeRegistry.forEach((store) => {
    const initialState = initialStates.get(store);
    if (initialState) {
      store.setState(initialState, true);
    }
  });
}

/**
 * 특정 store를 registry에서 제거합니다. (cleanup용)
 */
export function unregisterStore(store: StoreApi<any>) {
  storeRegistry.delete(store);
  initialStates.delete(store);
}
