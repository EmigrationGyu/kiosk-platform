import { Transport } from 'transport/Transport';
import type { PermissionEventMap } from '../constants/events/Permission';
import { PermissionResponseSchemas } from '../constants/events/Permission';
import { NAMESPACES } from '../constants/Namespaces';

export class Permission extends Transport<PermissionEventMap> {
  public constructor() {
    super(NAMESPACES.PERMISSION, PermissionResponseSchemas);
  }
}
