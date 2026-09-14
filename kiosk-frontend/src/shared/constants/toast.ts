export const TOAST_TYPE = {
  NORMAL: 'normal',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

export type ToastType = (typeof TOAST_TYPE)[keyof typeof TOAST_TYPE];

export type ToastItem = {
  id: string;
  type: ToastType;
  text: string;
  timeout?: number;
};
