import { Router } from '@ipc/Router';
import type { EndpointsMap } from '../constants/endpoints';
import { OUTBOX_PIPE_PATH, OutboxSchemas } from '../constants/endpoints';

export class OutboxRouter extends Router<EndpointsMap> {
  constructor() {
    super(OUTBOX_PIPE_PATH, OutboxSchemas);
  }
}
