import type { ToastItem, ToastType } from '@/shared/constants/toast';
import { createStore } from '@/shared/store/storeRegistry';

type ToastStore = {
  toastList: ToastItem[];
  openToast: (type: ToastType, text: string, timeout?: number) => string;
  closeToast: (id: string) => void;
};

export const useToastStore = createStore<ToastStore>((set) => ({
  toastList: [],
  openToast: (type: ToastType, text: string, timeout = 3000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: ToastItem = { id, type, text, timeout };

    set((state) => ({
      toastList: [newToast, ...state.toastList],
    }));

    // 타임아웃이 설정되어 있으면 자동으로 닫기
    if (timeout > 0) {
      setTimeout(() => {
        set((state) => ({
          toastList: state.toastList.filter((toast) => toast.id !== id),
        }));
      }, timeout);
    }

    return id;
  },
  closeToast: (id: string) => {
    set((state) => ({
      toastList: state.toastList.filter((toast) => toast.id !== id),
    }));
  },
}));
