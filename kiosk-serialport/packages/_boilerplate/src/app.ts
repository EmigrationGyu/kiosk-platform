import type { ControllerHandlers } from '@/shared/IPCServer/types';
import type { EndpointsMap } from './constants/endpoints';
import { DeviceController } from './controller/DeviceController';
import { DeviceRouter } from './router/DeviceRouter';

type RouteEntry = [DeviceRouter, () => ControllerHandlers<EndpointsMap>];

function routeEntries(app: App): RouteEntry[] {
  return [[app.deviceRouter, () => new DeviceController().handlers]];
}

export class App {
  deviceRouter: DeviceRouter;

  constructor() {
    this.deviceRouter = new DeviceRouter();
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
