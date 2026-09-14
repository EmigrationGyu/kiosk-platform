import type { ControllerHandlers } from '@/shared/IPCServer/types';
import type { EndpointsMap } from './constants/endpoints';
import { TokenDispenserController } from './controller/TokenDispenserController';
import { TokenDispenserRouter } from './router/TokenDispenserRouter';

type RouteEntry = [
  TokenDispenserRouter,
  () => ControllerHandlers<EndpointsMap>,
];

function routeEntries(app: App): RouteEntry[] {
  return [
    [app.tokenDispenserRouter, () => new TokenDispenserController().handlers],
  ];
}

export class App {
  tokenDispenserRouter: TokenDispenserRouter;

  constructor() {
    this.tokenDispenserRouter = new TokenDispenserRouter();
  }

  async start() {
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
