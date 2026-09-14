import { createStore } from '@/shared/store/storeRegistry';
import {
  MODAL_OPTION_KEYS,
  type ModalItem,
  type ModalKeysNoProps,
  type ModalKeysOptionalOnlyProps,
  type ModalKeysRequiredProps,
  type ModalOptions,
  type ModalPropsMap,
  type ModalRegistry,
} from './types';

type Keys = keyof ModalRegistry;

type KeysNoProps = ModalKeysNoProps;
type KeysRequiredProps = ModalKeysRequiredProps;
type KeysOptionalOnlyProps = ModalKeysOptionalOnlyProps;

type OpenModal = {
  <K extends KeysNoProps>(modalType: K, options?: ModalOptions): void;
  <K extends KeysRequiredProps>(
    modalType: K,
    props: ModalPropsMap[K],
    options?: ModalOptions,
  ): void;
  <K extends KeysOptionalOnlyProps>(
    modalType: K,
    props?: ModalPropsMap[K],
    options?: ModalOptions,
  ): void;
};

export type ModalStore = {
  modalList: ModalItem[];
  openModal: OpenModal;
  closeModal: <K extends Keys>(modalType: K) => void;
  popModal: () => void;
  clearModal: () => void;
  replaceModal: OpenModal;
};

const parseModalArgs = (
  propsOrOptions?: ModalPropsMap[Keys] | ModalOptions,
  maybeOptions?: ModalOptions,
): { props: ModalPropsMap[Keys] | undefined; options: ModalOptions } => {
  const isOptionsOnly =
    propsOrOptions &&
    Object.keys(propsOrOptions).every((key) => MODAL_OPTION_KEYS.has(key));
  return {
    props: isOptionsOnly
      ? undefined
      : (propsOrOptions as ModalPropsMap[Keys] | undefined),
    options: (isOptionsOnly
      ? (propsOrOptions as ModalOptions)
      : maybeOptions) ?? { closeOnOverlayClick: false },
  };
};

const buildModalItem = (
  modalType: Keys,
  props: ModalPropsMap[Keys] | undefined,
  options: ModalOptions,
): ModalItem =>
  props === undefined
    ? ({ modalType, options } as ModalItem)
    : ({ modalType, props, options } as ModalItem);

export const useModalStore = createStore<ModalStore>((set) => {
  const openModal: OpenModal = ((
    modalType: Keys,
    propsOrOptions?: ModalPropsMap[Keys] | ModalOptions,
    maybeOptions?: ModalOptions,
  ) => {
    const { props, options } = parseModalArgs(propsOrOptions, maybeOptions);
    set((state) => ({
      modalList: [
        ...state.modalList,
        buildModalItem(modalType, props, options),
      ],
    }));
  }) as OpenModal;

  const closeModal = <K extends Keys>(modalType: K) => {
    set((state) => ({
      modalList: state.modalList.filter((m) => m.modalType !== modalType),
    }));
  };

  const popModal = () => {
    set((state) => ({
      modalList: state.modalList.slice(0, -1),
    }));
  };

  const clearModal = () => set({ modalList: [] });

  const replaceModal: OpenModal = ((
    modalType: Keys,
    propsOrOptions?: ModalPropsMap[Keys] | ModalOptions,
    maybeOptions?: ModalOptions,
  ) => {
    const { props, options } = parseModalArgs(propsOrOptions, maybeOptions);
    set((state) => ({
      modalList: [
        ...state.modalList.slice(0, -1),
        buildModalItem(modalType, props, options),
      ],
    }));
  }) as OpenModal;

  return {
    modalList: [],
    openModal,
    closeModal,
    popModal,
    clearModal,
    replaceModal,
  };
});
