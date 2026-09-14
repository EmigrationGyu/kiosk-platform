import { type DependencyList, useEffect, useRef } from 'react';

type AbortableEffectCallback = (signal: AbortSignal) => void | Promise<void>;

/**
 * useEffect + AbortController. effect 함수에 signal 을 주입하고 unmount/deps 변경 시
 * 자동으로 abort.
 *
 * 반환된 abort 함수는 호출부에서 명시적으로 abort 가 필요할 때 사용 (예: 취소 버튼 클릭
 * 직후 — `<AnimatePresence>` exit 애니메이션이 끝날 때까지 unmount 가 지연되어 자연
 * cleanup 만으로는 abort 가 늦게 발화하는 케이스). 호출부가 안 쓰면 그냥 무시 — cleanup
 * 으로도 결국 abort 됨.
 *
 * signal 은 모든 await 경계에서 수동 체크해야 한다 — 자체적으로 signal 을 honor 하지
 * 않는 Promise 는 abort 후에도 끝까지 진행되며, 이어지는 setState/dispatch 가 stale
 * write 가 된다.
 *
 * effect 가 async 인 경우 hook 은 반환된 Promise 를 await 하지도, .catch 도 하지 않는다 —
 * 에러 처리는 호출부가 effect 내부 try/catch 로 책임진다. 정책상 silent swallow 금지.
 */
export function useAbortableEffect(
  effect: AbortableEffectCallback,
  deps?: DependencyList,
): () => void {
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      effect(controller.signal);
      return () => controller.abort();
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps 는 호출부에서 관리
    deps,
  );

  return () => controllerRef.current?.abort();
}
