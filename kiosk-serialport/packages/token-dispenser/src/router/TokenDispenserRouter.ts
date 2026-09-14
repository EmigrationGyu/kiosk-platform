import { Router } from '@ipc/Router';
import { TOKEN_DISPENSER_PIPE_PATH } from 'kiosk-types';
import type { EndpointsMap } from '../constants/endpoints';
import { TokenDispenserSchemas } from '../constants/endpoints';

export class TokenDispenserRouter extends Router<EndpointsMap> {
  constructor() {
    super(TOKEN_DISPENSER_PIPE_PATH, TokenDispenserSchemas);
  }
}
