import { useKeyboardStore } from './store';

export const useKeyboard = () => {
  const openKeyboard = useKeyboardStore((s) => s.open);
  const closeKeyboard = useKeyboardStore((s) => s.close);

  return {
    openKeyboard,
    closeKeyboard,
  };
};
