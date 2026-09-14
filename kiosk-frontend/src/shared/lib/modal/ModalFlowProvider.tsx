import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { FlowToken } from './flowToken';
import { useModalStore } from './store';

// ─── Internal context types ───────────────────────────────────────────────────

type FlowRegistryValue = {
  flows: ReadonlyMap<FlowToken<unknown>, unknown>;
  setData: (token: FlowToken<unknown>, updater: unknown) => void;
};

// 외부로 노출하지 않음 — useModalFlowState 만 접근
const FlowRegistryContext = createContext<FlowRegistryValue | null>(null);
const CurrentFlowTokenContext = createContext<FlowToken<unknown> | null>(null);

// ─── Internal hooks (useModalFlowState 에서만 사용) ───────────────────────────

export function useFlowRegistryInternal() {
  return useContext(FlowRegistryContext);
}

export function useCurrentFlowTokenInternal() {
  return useContext(CurrentFlowTokenContext);
}

// ─── ModalFlowProvider ────────────────────────────────────────────────────────

/**
 * 모달 플로우 상태 저장소.
 * 두 컨테이너(ModalContainer, OverlayModalContainer)의 공통 조상에 배치한다.
 * React 포털은 React 트리의 context를 그대로 상속하므로 두 컨테이너 모두에서 접근 가능.
 *
 * 전역 상태 오염을 구조적으로 차단하기 위해 Context 기반으로 설계됨. Zustand 직접 사용은 의도적으로 배제
 */
export function ModalFlowProvider({ children }: { children: ReactNode }) {
  const [flows, setFlows] = useState<Map<FlowToken<unknown>, unknown>>(
    new Map(),
  );
  const modalList = useModalStore((s) => s.modalList);

  // 플로우에 속한 모달이 모두 닫히면 공유 상태 자동 초기화
  useEffect(() => {
    const activeTokens = new Set<symbol>(
      modalList.flatMap((m) =>
        m.options?.flowToken ? [m.options.flowToken] : [],
      ),
    );

    setFlows((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const token of next.keys()) {
        if (!activeTokens.has(token)) {
          next.delete(token);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [modalList]);

  const setData = (token: FlowToken<unknown>, updater: unknown) => {
    setFlows((prev) => {
      const next = new Map(prev);
      const current = next.get(token);
      next.set(
        token,
        typeof updater === 'function'
          ? (updater as (prev: unknown) => unknown)(current)
          : updater,
      );
      return next;
    });
  };

  return (
    <FlowRegistryContext.Provider value={{ flows, setData }}>
      {children}
    </FlowRegistryContext.Provider>
  );
}

// ─── ModalFlowBoundary ────────────────────────────────────────────────────────

/**
 * ModalRenderer 가 각 모달을 렌더링할 때 자동으로 감싸는 경계.
 * flowToken 이 없으면 투명하게 통과시킨다.
 */
export function ModalFlowBoundary({
  flowToken,
  children,
}: {
  flowToken?: FlowToken<unknown>;
  children: ReactNode;
}) {
  if (!flowToken) {
    return <>{children}</>;
  }
  return (
    <CurrentFlowTokenContext.Provider value={flowToken}>
      {children}
    </CurrentFlowTokenContext.Provider>
  );
}
