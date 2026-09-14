import { TokenDispenserSchemas } from '../constant/events/TokenDispenser';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class TokenDispenserRouter extends Router<
  typeof NAMESPACES.TOKEN_DISPENSER
> {
  constructor() {
    super(NAMESPACES.TOKEN_DISPENSER, TokenDispenserSchemas);
  }
}
