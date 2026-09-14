import { useEffect, useSyncExternalStore } from 'react';
import { useModalStateStoreInternal } from './ModalStateProvider';
import { type ModalStore, useModalStore } from './store';
import type {
  ModalStateRegistry,
  ModalStateTuples,
  StatefulModalKey,
} from './types';

type ModalApi = {
  openModal: ModalStore['openModal'];
  closeModal: ModalStore['closeModal'];
  popModal: ModalStore['popModal'];
  /**
   * 주의: 해당 함수를 남용하지 마세요.
   *
   * modalList를 비우는 행위는 의도치 않은 모달 동작으로 인해 **디버그가 어려워지는** 상황을 만들 수 있습니다.
   *
   * 모든 맥락을 **완벽하게** 파악하고, 현재 뿐만 아닌 이후에도 문제가 되지 않는 상황
   *
   * 혹은 아직 전부 구현 되지 않은 임시 코드에만 사용하세요.
   */
  clearModal: ModalStore['clearModal'];
  replaceModal: ModalStore['replaceModal'];
};

const noopSubscribe = () => () => undefined;
const getUndefined = () => undefined;

/**
 * 필드 접근 시점에 [값, setter] 튜플을 만들어 주는 lazy 투영.
 * 필드 목록은 타입 소거로 런타임에 없으므로 Proxy 가 유일한 수단이다 —
 * 필드 직접 접근 전용이고 spread/Object.keys 는 지원하지 않는다.
 */
const projectFieldTuples = (
  record: Readonly<Record<string, unknown>> | undefined,
  setField: (field: string, updater: unknown) => void,
): unknown =>
  new Proxy(
    {},
    {
      get: (_target, field) =>
        typeof field === 'string'
          ? [record?.[field], (updater: unknown) => setField(field, updater)]
          : undefined,
    },
  );

/**
 * 모달 열기/닫기 API. 인자 없이 부르면 기존 그대로다.
 *
 * `ModalStateRegistry` 에 공유 상태를 선언한 모달 키를 넘기면, 그 모달과
 * 여는 쪽이 공유하는 필드별 useState 튜플 맵(`modalState`)이 함께 열린다.
 *
 * @example
 * const { openModal, modalState } = useModal(MODAL_TYPE.SLEEP_COUNT_SELECT);
 * const [sleeps, setSleeps] = modalState.sleeps; // [number | undefined, Dispatch<...>]
 */
export function useModal(): ModalApi;
export function useModal<K extends StatefulModalKey>(
  modalType: K,
): ModalApi & { modalState: ModalStateTuples<ModalStateRegistry[K]> };
export function useModal(
  modalType?: StatefulModalKey,
): ModalApi & { modalState?: unknown } {
  const openModal = useModalStore((s) => s.openModal);
  const closeModal = useModalStore((s) => s.closeModal);
  const popModal = useModalStore((s) => s.popModal);
  const clearModal = useModalStore((s) => s.clearModal);
  const replaceModal = useModalStore((s) => s.replaceModal);

  const store = useModalStateStoreInternal();

  // 마운트 동안 키를 hold — 모달이 닫힌 뒤에도 opener 가 결과를 읽을 수 있게 한다.
  useEffect(() => {
    if (!modalType || !store) return;
    return store.hold(modalType);
  }, [modalType, store]);

  const record = useSyncExternalStore(
    modalType && store
      ? (listener: () => void) => store.subscribe(modalType, listener)
      : noopSubscribe,
    modalType && store ? () => store.getRecord(modalType) : getUndefined,
  );

  const api: ModalApi = {
    openModal,
    closeModal,
    popModal,
    clearModal,
    replaceModal,
  };

  if (!modalType) return api;

  if (!store) {
    throw new Error(
      'useModal(modalType): ModalStateProvider 를 찾을 수 없습니다. ' +
        '페이지(Outlet)와 모달 컨테이너의 공통 조상에 <ModalStateProvider> 를 추가하세요.',
    );
  }

  return {
    ...api,
    modalState: projectFieldTuples(record, (field, updater) =>
      store.setField(modalType, field, updater),
    ),
  };
}
