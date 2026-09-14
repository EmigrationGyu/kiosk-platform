import type { Server, Namespace as SocketNamespace } from 'socket.io';
import type { z } from 'zod';
import type { SocketHandler, SocketRequest } from '../../../types/Socket';
import { createSocketServer } from '../../socket/Socket';
import { processRequest } from '../processRequest';
import type { IChannel } from '../types';

export class Channel implements IChannel {
  namespace: string;
  private nsp: SocketNamespace;
  private io: Server = createSocketServer();
  private schemas: Record<string, z.ZodSchema>;

  private handlers: Map<string, SocketHandler<any, any>> = new Map();
  private connectionInitialized = false;

  constructor(namespace: string, schemas: Record<string, z.ZodSchema>) {
    this.namespace = namespace;
    this.nsp = this.io.of(namespace);
    this.initConnectionListener();
    this.schemas = schemas;
  }

  private initConnectionListener() {
    if (this.connectionInitialized) return;
    this.connectionInitialized = true;

    this.nsp.on('connection', (socket) => {
      // 연결된 소켓에 바인딩한 리스너를 추적
      const bound: Array<[string, (request: SocketRequest<any>) => void]> = [];

      for (const event of this.handlers.keys()) {
        const listener = async (request: SocketRequest<any>) => {
          // 핸들러는 호출 시점에 조회한다(HMR 핫스왑 대응).
          const response = await processRequest(
            event,
            request,
            this.schemas[event],
            this.handlers.get(event),
          );
          // 응답은 요청한 소켓에게만 보낸다 — nsp.emit(브로드캐스트) 금지.
          socket.emit(event, response);
        };

        bound.push([event, listener]);
        socket.on(event, listener);
      }

      const cleanup = () => {
        for (const [event, listener] of bound) {
          socket.off(event, listener);
        }
        bound.length = 0;
      };

      socket.once('disconnect', cleanup);
      socket.once('disconnecting', cleanup);
    });
  }

  public on<TRequest = unknown, TResponse = unknown>(
    event: string,
    callback: SocketHandler<TRequest, TResponse>,
  ) {
    if (this.handlers.has(event)) {
      throw new Error(`Event ${event} already served`);
    }
    this.handlers.set(event, callback as SocketHandler<any, any>);
  }

  public replaceHandlers(
    handlers: Map<string, SocketHandler<unknown, unknown>>,
  ) {
    for (const [event, handler] of handlers) {
      if (!this.handlers.has(event)) {
        throw new Error(`Cannot replace unregistered event: ${event}`);
      }
      this.handlers.set(event, handler as SocketHandler<any, any>);
    }
  }
}
