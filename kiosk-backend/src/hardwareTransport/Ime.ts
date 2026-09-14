import { Transport } from '@hardwareTransport/Transport';
import { SERIALPORT_PROCESS } from 'kiosk-types';
import type { ImeEventMap } from './events/Ime';
import { ImeSchemas } from './events/Ime';

export class Ime extends Transport<ImeEventMap> {
  private static instance: Ime | undefined;
  private constructor() {
    super(SERIALPORT_PROCESS.IME, ImeSchemas);
  }

  public static getInstance(): Ime {
    if (!Ime.instance) {
      Ime.instance = new Ime();
    }
    return Ime.instance;
  }
}
