import type { ControllerHandlers, EventMap } from './types';

export abstract class BaseController<M extends EventMap> {
  readonly handlers: Readonly<ControllerHandlers<M>>;
  constructor(handlers: ControllerHandlers<M>) {
    this.handlers = Object.freeze(handlers);
  }
}

export type { Handler } from './types';
