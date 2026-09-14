import { useEffect } from 'react';
import { useConst } from './useConst';

/**
 * 컴포넌트 라이프타임에 묶이는 AbortController. unmount 시 자동 abort.
 *
 * `useAbortableEffect` 와 달리 effect 함수를 받지 않음 — 자식 컴포넌트에 signal 을
 * prop 으로 전달하거나, 호출부가 직접 controller 를 다루어야 하는 경우 사용.
 */
export function useAbortController(): AbortController {
  const controller = useConst(() => new AbortController());
  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트/언마운트 1회만
  useEffect(() => () => controller.abort(), []);
  return controller;
}
