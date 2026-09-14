import type { ControllerHandlers } from '@/shared/IPCServer/types';
import type { EndpointsMap } from './constants/endpoints';
import { ImeController } from './controller/ImeController';
import { ImeRouter } from './router/ImeRouter';

type RouteEntry = [ImeRouter, () => ControllerHandlers<EndpointsMap>];

function routeEntries(app: App): RouteEntry[] {
  return [[app.imeRouter, () => new ImeController().handlers]];
}

export class App {
  imeRouter: ImeRouter;

  constructor() {
    this.imeRouter = new ImeRouter();
  }

  start() {
    this.setupRouters();
  }

  private setupRouters() {
    for (const [router, getHandlers] of routeEntries(this)) {
      router.serveAll(getHandlers());
    }
  }

  static reload(app: App) {
    for (const [router, getHandlers] of routeEntries(app)) {
      router.replaceHandlers(getHandlers());
    }
  }
}
