import type {
  EventMap,
  ITransport,
  RequestArgs,
} from '@/shared/types/transport';
import { mockRegistry } from './mockRegistry';

export class Transport<M extends EventMap = EventMap> implements ITransport<M> {
  private readonly namespace: string;

  protected constructor(namespace: string, _schemaMap: unknown) {
    this.namespace = namespace;
  }

  public withTimeout(): ITransport<M> {
    return this;
  }

  public withRetry(): ITransport<M> {
    return this;
  }

  public request<E extends keyof M & string>(
    _event: E,
    ..._args: RequestArgs<M[E]['request']>
  ): Promise<M[E]['response']> {
    let event = _event as string;
    if (!event.startsWith('/')) {
      event = `/${event}`;
    }

    const handler = mockRegistry[this.namespace]?.[event];

    if (!handler) {
      console.warn(`[MockTransport] No mock for ${this.namespace}${event}`);
      return Promise.resolve(undefined as M[E]['response']);
    }

    const result = handler(_args[0]);
    return Promise.resolve(result).then((resolved) => {
      console.debug(`[MockTransport] ${this.namespace}${event}`, resolved);
      return resolved as M[E]['response'];
    });
  }
}
