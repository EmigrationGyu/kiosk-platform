import { ImeSchemas } from '../constant/events/Ime';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class ImeRouter extends Router<typeof NAMESPACES.IME> {
  constructor() {
    super(NAMESPACES.IME, ImeSchemas);
  }
}
