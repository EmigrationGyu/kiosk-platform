// 하위 호환용 re-export. 타입은 types.ts에서, Router 클래스는 @ipc/Router alias에서 가져온다.
export type {
  ControllerHandlers,
  EventMap,
  Handler,
  HandlerError,
  HandlerResponse,
  HandlerSuccess,
  IRouter,
  MaybePromise,
  RequestSchemaMap,
} from './types';
