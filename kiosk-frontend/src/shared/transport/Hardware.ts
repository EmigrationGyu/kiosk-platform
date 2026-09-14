import { Transport } from 'transport/Transport';
import type { HardwareEventMap } from '../constants/events/Hardware';
import { HardwareResponseSchemas } from '../constants/events/Hardware';
import { NAMESPACES } from '../constants/Namespaces';

export class Hardware extends Transport<HardwareEventMap> {
  public constructor() {
    super(NAMESPACES.HARDWARE, HardwareResponseSchemas);
  }
}
