/**
 * 모달 키의 닫힌 집합.
 *
 * 여는 쪽은 **키만 안다** — 컴포넌트를 import 하지 않는다. 그래서 모달을 교체해도
 * 호출부가 안 바뀌고, 등록을 빠뜨리면 `defineExactMap` 이 컴파일에서 잡는다.
 */
export const MODAL_TYPE = {
  /** 방출 매수 선택 — opener 와 상태를 공유한다(`ModalStateRegistry` 참고). */
  TOKEN_COUNT_SELECT: 'TOKEN_COUNT_SELECT',
  /** 장치 오류 안내. */
  DEVICE_ERROR: 'DEVICE_ERROR',
} as const;

export type ModalType = (typeof MODAL_TYPE)[keyof typeof MODAL_TYPE];
