import type { GlobalTheme } from '../types/theme';
import { createStore } from './storeRegistry';

interface ThemeStore {
  theme: GlobalTheme;
  setTheme: (theme: GlobalTheme) => void;
}

const defaultTheme: GlobalTheme = 'light';

export const useThemeStore = createStore<ThemeStore>((set) => ({
  theme: defaultTheme,
  setTheme: (theme) => set({ theme }),
}));

// 편의 셀렉터 훅
export const useGlobalTheme = () => useThemeStore((s) => s.theme);
export const useSetGlobalTheme = () => useThemeStore((s) => s.setTheme);
