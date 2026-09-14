export type {
  EventMap,
  Handler as SocketHandler,
  HandlerError as SocketError,
  HandlerResponse as SocketResponse,
  HandlerSuccess as SocketSuccess,
  MaybePromise,
} from 'kiosk-types';

export type SocketRequest<T = unknown> = {
  id: string;
  body: T;
};
