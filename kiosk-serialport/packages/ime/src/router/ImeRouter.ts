import { Router } from '@ipc/Router';
import { IME_PIPE_PATH } from 'kiosk-types';
import type { EndpointsMap } from '../constants/endpoints';
import { ImeSchemas } from '../constants/endpoints';

export class ImeRouter extends Router<EndpointsMap> {
  constructor() {
    super(IME_PIPE_PATH, ImeSchemas);
  }
}
