import type { ComponentType, Dispatch, SetStateAction } from 'react';
import type { FlowToken } from './flowToken';

/**
 * 모달 레지스트리 인터페이스 — app 레이어에서 declaration merging 으로 확장된다.
 *
 * 직접 채우지 말고 `MODAL_MAP` 한 곳에 컴포넌트를 등록하면 `typeof MODAL_MAP` 에서 파생된 타입으로
 * 자동 추론된다(배선은 `app/providers/modal/registry.ts` 참고).
 */
export interface ModalRegistry {
  // declaration merging을 위해 의도적으로 비워둠
  // app/providers/modal/registry.ts에서 MODAL_MAP으로부터 파생되어 확장됨
}

// children 제거 유틸
type WithoutChildren<T> = T extends object ? Omit<T, 'children'> : T;

// 컴포넌트의 실질 props 추론 (children 제외, 비어 있으면 never)
type PropsOf<T> = T extends () => unknown
  ? never
  : T extends (props: infer P) => unknown
    ? keyof WithoutChildren<P> extends never
      ? never
      : WithoutChildren<P>
    : T extends ComponentType<infer P>
      ? keyof WithoutChildren<P> extends never
        ? never
        : WithoutChildren<P>
      : never;

// 모달 타입별 Props 매핑
export type ModalPropsMap = {
  [K in keyof ModalRegistry]: PropsOf<ModalRegistry[K]>;
};

// 모달 공통 옵션
export type ModalOptions = {
  /** 오버레이 클릭 시 닫히도록 할지 여부 (기본값 false) */
  closeOnOverlayClick?: boolean;
  /** 모달이 열려있을 때 Footer 버튼 비활성화 여부 (기본값 false) */
  shouldDisableFooter?: boolean;
  /** 키보드/푸터/바텀시트 위에 전체 화면으로 렌더링할지 여부 (기본값 false) */
  overlay?: boolean;
  /**
   * 이 모달이 속한 플로우의 토큰.
   * 동일한 토큰을 가진 모달들끼리 상태를 공유한다.
   * 마지막 모달이 닫히면 공유 상태는 자동으로 초기화된다.
   */
  flowToken?: FlowToken<unknown>;
  /** 모달 우상단에 닫기(X) 버튼을 표시할지 여부 (기본값 false) */
  showCloseButton?: boolean;
};

/**
 * ModalOptions 의 모든 키를 런타임에서 판별하기 위한 Set. `Record<keyof ModalOptions, true>` 덕분에
 * ModalOptions 에 키를 추가하면 여기도 반드시 추가해야 컴파일이 통과된다.
 */
const _modalOptionKeysRecord: Record<keyof ModalOptions, true> = {
  closeOnOverlayClick: true,
  shouldDisableFooter: true,
  overlay: true,
  flowToken: true,
  showCloseButton: true,
};
export const MODAL_OPTION_KEYS: ReadonlySet<string> = new Set(
  Object.keys(_modalOptionKeysRecord),
);

// 필수 프로퍼티 존재 여부 판별
type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

export type IsOptionalProps<T> = [RequiredKeys<T>] extends [never]
  ? true
  : false;

// 모달 아이템 유니온 (props 유무/필수성에 따라 분기)
type ModalItemBase = {
  [K in keyof ModalRegistry]: ModalPropsMap[K] extends never
    ? { modalType: K }
    : IsOptionalProps<ModalPropsMap[K]> extends true
      ? { modalType: K; props?: ModalPropsMap[K] }
      : { modalType: K; props: ModalPropsMap[K] };
}[keyof ModalRegistry];

export type ModalItem = ModalItemBase & { options?: ModalOptions };

// 모달 타입에 따른 Props 추론 유틸
export type GetModalProps<T extends keyof ModalRegistry> = ModalPropsMap[T];

// ── 모달 공유 상태 (opener ↔ 모달) ──────────────────────────────────────────
//
// flowToken 과는 별개 개념: flowToken 은 "같은 플로우의 모달들끼리",
// modalState 는 "여는 쪽 ↔ 그 모달"의 계약이고 식별자는 모달 키 자체다.

/**
 * 모달 키 → opener 와 공유하는 상태 타입.
 * 모달 컴포넌트 파일에서 declaration merging 으로 확장한다.
 *
 * @example
 * // flows/walkIn/components/SleepCountSelectModal.tsx
 * declare module '@/shared/lib/modal/types' {
 *   interface ModalStateRegistry {
 *     [MODAL_TYPE.SLEEP_COUNT_SELECT]: { sleeps: number };
 *   }
 * }
 */
export interface ModalStateRegistry {
  // declaration merging을 위해 의도적으로 비워둠
}

/** 공유 상태를 선언한 모달 키만 useModal(key) 에 넘길 수 있다. */
export type StatefulModalKey = keyof ModalStateRegistry;

/**
 * 선언된 객체 타입을 필드별 useState 튜플로 투영한다.
 * 모든 필드는 seed 전까지 undefined 로 시작한다(초기값 없는 useState 와 동일).
 */
export type ModalStateTuples<S> = {
  readonly [P in keyof S]-?: [
    S[P] | undefined,
    Dispatch<SetStateAction<S[P] | undefined>>,
  ];
};

// ── 모달 키 집합 (props 필수성 기준) ────────────────────────────────────────
//
// `openModal`/`replaceModal` 의 오버로드가 이 셋으로 갈린다. 라우팅 표처럼 모달 타입을
// **값으로 들고 다니는** 코드도 같은 기준이 필요하므로 store 안에 가두지 않는다.

/** props 가 아예 없는 모달 — `replaceModal(k, { flowToken })` 로 연다. */
export type ModalKeysNoProps = {
  [K in keyof ModalRegistry]: ModalPropsMap[K] extends never ? K : never;
}[keyof ModalRegistry];

/** 필수 props 가 있는 모달 — props 인자를 반드시 넘겨야 한다. */
export type ModalKeysRequiredProps = {
  [K in keyof ModalRegistry]: ModalPropsMap[K] extends never
    ? never
    : IsOptionalProps<ModalPropsMap[K]> extends true
      ? never
      : K;
}[keyof ModalRegistry];

/** props 가 전부 선택인 모달 — 생략하고 열 수 있다. */
export type ModalKeysOptionalOnlyProps = Exclude<
  keyof ModalRegistry,
  ModalKeysNoProps | ModalKeysRequiredProps
>;
