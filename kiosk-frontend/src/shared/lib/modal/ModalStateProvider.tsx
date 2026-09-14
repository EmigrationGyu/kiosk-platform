import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { createModalStateStore, type ModalStateStore } from './modalStateStore';
import { useModalStore } from './store';

// 외부로 노출하지 않음 — useModal 만 접근
const ModalStateStoreContext = createContext<ModalStateStore | null>(null);

export function useModalStateStoreInternal() {
  return useContext(ModalStateStoreContext);
}

/**
 * opener ↔ 모달 공유 상태(modalState)의 저장소.
 * opener 는 페이지 컴포넌트이므로 페이지(Outlet)와 모달 컨테이너 양쪽의
 * 공통 조상에 배치해야 한다 — 모달 컨테이너만 감싸는 ModalFlowProvider 로는 부족하다.
 *
 * 컨텍스트 값은 스토어 객체 하나로 불변이다. 상태 변경은 컨텍스트 리렌더가 아니라
 * useSyncExternalStore 의 키 단위 구독으로만 전파되므로 트리 전체를 감싸도 안전하다.
 */
export function ModalStateProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createModalStateStore);
  const modalList = useModalStore((s) => s.modalList);

  useEffect(() => {
    store.syncOpenModals(new Set(modalList.map((m) => m.modalType)));
  }, [modalList, store]);

  return (
    <ModalStateStoreContext.Provider value={store}>
      {children}
    </ModalStateStoreContext.Provider>
  );
}
