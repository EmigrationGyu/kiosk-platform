import { z } from 'zod';

export const PERMISSION_EVENTS = {
  SAVE_TOKEN: '/save_token',
  GET_TOKEN: '/get_token',
  DELETE_TOKEN: '/delete_token',
  HAS_TOKEN: '/has_token',
} as const;

export const PermissionSchemas = {
  [PERMISSION_EVENTS.SAVE_TOKEN]: z.string(),
  [PERMISSION_EVENTS.GET_TOKEN]: z.void(),
  [PERMISSION_EVENTS.DELETE_TOKEN]: z.void(),
  [PERMISSION_EVENTS.HAS_TOKEN]: z.void(),
} satisfies Record<keyof PermissionEventMap, z.ZodType>;

// ── Response schemas ─────────────────────────────────────────────────────────

export const PermissionResponseSchemas = {
  [PERMISSION_EVENTS.SAVE_TOKEN]: z.void(),
  [PERMISSION_EVENTS.GET_TOKEN]: z.string().nullable(),
  [PERMISSION_EVENTS.DELETE_TOKEN]: z.boolean(),
  [PERMISSION_EVENTS.HAS_TOKEN]: z.boolean(),
} satisfies Record<keyof PermissionEventMap, z.ZodType>;

export type PermissionEventMap = {
  [PERMISSION_EVENTS.SAVE_TOKEN]: {
    request: z.infer<
      (typeof PermissionSchemas)[typeof PERMISSION_EVENTS.SAVE_TOKEN]
    >;
    response: void;
  };
  [PERMISSION_EVENTS.GET_TOKEN]: {
    request: void;
    response: string | null;
  };
  [PERMISSION_EVENTS.DELETE_TOKEN]: {
    request: void;
    response: boolean;
  };
  [PERMISSION_EVENTS.HAS_TOKEN]: {
    request: void;
    response: boolean;
  };
};
