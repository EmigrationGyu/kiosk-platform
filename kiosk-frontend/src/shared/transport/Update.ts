import { Transport } from 'transport/Transport';
import type { UpdateEventMap } from '../constants/events/Update';
import { UpdateResponseSchemas } from '../constants/events/Update';
import { NAMESPACES } from '../constants/Namespaces';

export class Update extends Transport<UpdateEventMap> {
  public constructor() {
    super(NAMESPACES.UPDATE, UpdateResponseSchemas);
  }
}
