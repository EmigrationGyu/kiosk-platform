import { OutboxSchemas } from '../constant/events/Outbox';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class OutboxRouter extends Router<typeof NAMESPACES.OUTBOX> {
  constructor() {
    super(NAMESPACES.OUTBOX, OutboxSchemas);
  }
}
