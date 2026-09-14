export type {
  ControllerHandlers,
  EventMap,
  Handler,
  HandlerError,
  HandlerResponse,
  HandlerSuccess,
  IRouter,
  MaybePromise,
} from 'kiosk-types';

import type { EventMap } from 'kiosk-types';
// RequestSchemaMap은 kiosk-types에 없으므로 로컬 정의 유지
import type { z } from 'zod';
export type RequestSchemaMap<M extends EventMap> = {
  [E in keyof M & string]: z.ZodSchema<M[E]['request']>;
};
