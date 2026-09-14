import { Channel } from '@channel/Channel';
import type { RequestSchemaMap } from 'kiosk-types';
import type { Namespace } from '../constant/Namespaces';
import type { ControllerHandlers } from '../controller/BaseController';
import type { IChannel } from '../helpers/channel/types';
import type { IRouter } from '../interfaces/Router';
import type { NamespaceEventMap } from '../types/Namespaces';
import { namespaceToEvents } from '../types/Namespaces';
import type { SocketHandler } from '../types/Socket';

abstract class BaseRouter<N extends Namespace> implements IRouter<N> {
  protected abstract eventSet: Set<string>;
  protected abstract namespace: IChannel;
  abstract serveAll(handlers: ControllerHandlers<NamespaceEventMap[N]>): void;
  abstract reload(handlers: ControllerHandlers<NamespaceEventMap[N]>): void;
}

export class Router<N extends Namespace> extends BaseRouter<N> {
  protected eventSet: Set<string> = new Set();
  protected namespace: IChannel;
  // 생성자에서 받은 네임스페이스 리터럴을 보관 — 채널에서 string 으로 되읽는
  // 캐스트(as unknown as N)를 제거하기 위함.
  private readonly ns: N;

  constructor(namespace: N, schemas: RequestSchemaMap<NamespaceEventMap[N]>) {
    super();
    this.ns = namespace;
    this.namespace = new Channel(namespace, schemas);
  }

  private serve<K extends Extract<keyof NamespaceEventMap[N], string>>(
    event: K,
    callback: ControllerHandlers<NamespaceEventMap[N]>[K],
  ) {
    if (this.eventSet.has(event)) {
      throw new Error(`Event ${event} already served`);
    }
    this.eventSet.add(event);
    this.namespace.on(event, callback);
  }

  public serveAll(handlers: ControllerHandlers<NamespaceEventMap[N]>) {
    // 라우팅 일원화 검증: 키 오타/누락 검출
    const expected = new Set(namespaceToEvents[this.ns]);

    for (const key of Object.keys(handlers)) {
      if (!expected.has(key)) {
        throw new Error(`Unknown handler key for namespace ${this.ns}: ${key}`);
      }
    }

    for (const key of expected) {
      if (!(key in handlers)) {
        throw new Error(`Missing handler for namespace ${this.ns}: ${key}`);
      }
    }

    const serveOne = <K extends Extract<keyof NamespaceEventMap[N], string>>(
      e: K,
      c: ControllerHandlers<NamespaceEventMap[N]>[K],
    ) => this.serve(e, c);

    for (const event of Object.keys(handlers) as Array<
      Extract<keyof NamespaceEventMap[N], string>
    >) {
      serveOne(event, handlers[event]);
    }
  }

  public reload(handlers: ControllerHandlers<NamespaceEventMap[N]>) {
    const handlerMap = new Map<string, SocketHandler<any, any>>();
    for (const [event, handler] of Object.entries(handlers)) {
      handlerMap.set(event, handler as SocketHandler<any, any>);
    }
    this.namespace.replaceHandlers(handlerMap);
  }
}
