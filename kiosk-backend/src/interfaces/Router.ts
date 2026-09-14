import type { Namespace } from '../constant/Namespaces';
import type { ControllerHandlers } from '../controller/BaseController';
import type { NamespaceEventMap } from '../types/Namespaces';

export interface IRouter<N extends Namespace> {
  serveAll(handlers: ControllerHandlers<NamespaceEventMap[N]>): void;
  reload(handlers: ControllerHandlers<NamespaceEventMap[N]>): void;
}
