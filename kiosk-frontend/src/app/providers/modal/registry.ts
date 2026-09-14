import DeviceErrorModal from '@/flows/demo/components/DeviceErrorModal';
import TokenCountSelectModal from '@/flows/demo/components/TokenCountSelectModal';
import { MODAL_TYPE, type ModalType } from '@/shared/constants/modal';

export { MODAL_TYPE, type ModalType };

/** 키 집합과 등록 집합이 **정확히** 같아야 한다 — 남거나 모자라면 컴파일 에러. */
function defineExactMap<K extends string>() {
  return <T extends Readonly<Record<K, unknown>>>(
    map: T & Record<Exclude<keyof T, K>, never>,
  ) => map;
}

export const MODAL_MAP = defineExactMap<ModalType>()({
  [MODAL_TYPE.TOKEN_COUNT_SELECT]: TokenCountSelectModal,
  [MODAL_TYPE.DEVICE_ERROR]: DeviceErrorModal,
});

/**
 * 컨테이너 모드. 스택을 둘로 나눈 이유는 쌓임 순서가 서로 독립이어야 하기 때문이다 —
 * 오버레이는 일반 모달 위에 뜨되 그들끼리의 순서를 따로 가진다.
 */
export const MODAL_CONTAINER_MAP = {
  STANDARD: 'standard',
  OVERLAY: 'overlay',
} as const;

declare module '@/shared/lib/modal/types' {
  interface ModalRegistry {
    [MODAL_TYPE.TOKEN_COUNT_SELECT]: typeof TokenCountSelectModal;
    [MODAL_TYPE.DEVICE_ERROR]: typeof DeviceErrorModal;
  }

  /** opener 와 공유하는 필드 — 여기 선언한 키만 `useModal(key).modalState` 를 얻는다. */
  interface ModalStateRegistry {
    [MODAL_TYPE.TOKEN_COUNT_SELECT]: { count: number | undefined };
  }
}
