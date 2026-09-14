import type { ControllerHandlers, EventMap } from 'kiosk-types';

export type { ControllerHandlers };

export abstract class BaseController<M extends EventMap> {
  readonly handlers: Readonly<ControllerHandlers<M>>;
  constructor(handlers: ControllerHandlers<M>) {
    this.handlers = Object.freeze(handlers);
  }
}
