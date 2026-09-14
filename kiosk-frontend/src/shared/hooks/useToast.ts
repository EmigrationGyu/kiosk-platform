import { useToastStore } from '@/shared/lib/toast/store';

export const useToast = () => {
  const openToast = useToastStore((s) => s.openToast);
  const closeToast = useToastStore((s) => s.closeToast);

  return {
    openToast,
    closeToast,
  };
};
