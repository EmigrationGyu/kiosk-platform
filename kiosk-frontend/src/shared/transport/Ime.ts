import { Transport } from 'transport/Transport';
import type { ImeEventMap } from '../constants/events/Ime';
import { ImeResponseSchemas } from '../constants/events/Ime';
import { NAMESPACES } from '../constants/Namespaces';

export class Ime extends Transport<ImeEventMap> {
  public constructor() {
    super(NAMESPACES.IME, ImeResponseSchemas);
  }
}
