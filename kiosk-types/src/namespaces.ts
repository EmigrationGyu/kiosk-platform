export const NAMESPACES = {
  HARDWARE: '/hardware',
  LOG: '/log',
  PERMISSION: '/permission',
  FILESYSTEM: '/filesystem',
  IME: '/ime',
  TOKEN_DISPENSER: '/token_dispenser',
  OUTBOX: '/outbox',
  UPDATE: '/update',
  // @gen:namespace
} as const;

export type Namespace = (typeof NAMESPACES)[keyof typeof NAMESPACES];
