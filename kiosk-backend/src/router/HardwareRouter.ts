import { HardwareSchemas } from '../constant/events/Hardware';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class HardwareRouter extends Router<typeof NAMESPACES.HARDWARE> {
  constructor() {
    super(NAMESPACES.HARDWARE, HardwareSchemas);
  }
}
