import { type Dispatch, type SetStateAction, useState } from 'react';
import type { FlowToken } from './flowToken';
import {
  useCurrentFlowTokenInternal,
  useFlowRegistryInternal,
} from './ModalFlowProvider';

/**
 * 현재 모달이 속한 플로우의 공유 상태를 읽고 쓴다.
 * useState 와 동일한 [state, setState] 튜플을 반환한다.
 *
 * @throws ModalFlowProvider 가 없는 경우
 * @throws 현재 모달에 flowToken 이 설정되지 않은 경우
 * @throws 전달한 token 이 현재 모달의 flowToken 과 다른 경우
 *
 * @example
 * // 플로우 토큰 상수 파일에서 import
 * const [state, setState] = useModalFlowState(PAYMENT_FLOW_TOKEN);
 * // state: PaymentFlowData | undefined
 */
export function useModalFlowState<T>(
  token: FlowToken<T>,
): [T | undefined, Dispatch<SetStateAction<T | undefined>>] {
  const registry = useFlowRegistryInternal();
  const currentToken = useCurrentFlowTokenInternal();

  // exit animation 중 flow state 가 cleanup 되더라도 마지막 유효 값을 유지.
  // closeModal() 호출 시 ModalFlowProvider 가 즉시 데이터를 삭제하지만,
  // AnimatePresence 는 animation(~250ms) 동안 컴포넌트를 계속 렌더링하므로
  // undefined 가 되는 순간 UI 가 깨지는 것을 방지한다.
  // 렌더 중 ref 쓰기 대신 "렌더 중 상태 조정"(React 공식 패턴)으로 유지한다 —
  // 아래 throw 들보다 앞에 있어야 훅 순서가 어긋나지 않는다.
  const [lastKnown, setLastKnown] = useState<T | undefined>(undefined);

  if (!registry) {
    throw new Error(
      'useModalFlowState: ModalFlowProvider 를 찾을 수 없습니다. ' +
        'MainLayout 등 두 모달 컨테이너의 공통 조상에 <ModalFlowProvider> 를 추가하세요.',
    );
  }

  if (currentToken === null) {
    throw new Error(
      'useModalFlowState: 현재 모달에 flowToken 이 설정되지 않았습니다. ' +
        'openModal 의 options 에 flowToken 을 전달하세요.',
    );
  }

  if (currentToken !== token) {
    throw new Error(
      'useModalFlowState: 전달한 token 이 현재 모달의 flowToken 과 일치하지 않습니다. ' +
        '올바른 FlowToken 상수를 전달했는지 확인하세요.',
    );
  }

  // FlowToken<T> extends symbol 이므로 Map 키로 직접 사용 가능.
  // Map<symbol, unknown> 에서 꺼낼 때 T 를 컴파일러가 알 수 없어 단언이 불가피.
  const data = registry.flows.get(token) as T | undefined;

  if (data !== undefined && data !== lastKnown) {
    setLastKnown(data);
  }

  const setState: Dispatch<SetStateAction<T | undefined>> = (updater) => {
    registry.setData(token, updater);
  };

  // flow 가 cleanup 된 경우(exit animation 중) 마지막 유효 값으로 폴백
  return [data ?? lastKnown, setState];
}
