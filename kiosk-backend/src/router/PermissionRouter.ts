import { PermissionSchemas } from '../constant/events/Permission';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class PermissionRouter extends Router<typeof NAMESPACES.PERMISSION> {
  constructor() {
    super(NAMESPACES.PERMISSION, PermissionSchemas);
  }
}
