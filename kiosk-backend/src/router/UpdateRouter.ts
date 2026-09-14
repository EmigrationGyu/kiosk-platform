import { UpdateSchemas } from '../constant/events/Update';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class UpdateRouter extends Router<typeof NAMESPACES.UPDATE> {
  constructor() {
    super(NAMESPACES.UPDATE, UpdateSchemas);
  }
}
