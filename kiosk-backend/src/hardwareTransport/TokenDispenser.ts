import { Transport } from '@hardwareTransport/Transport';
import { SERIALPORT_PROCESS } from 'kiosk-types';
import type { TokenDispenserSerialEventMap } from './events/TokenDispenser';
import { TokenDispenserSerialSchemas } from './events/TokenDispenser';

export class TokenDispenser extends Transport<TokenDispenserSerialEventMap> {
  private static instance: TokenDispenser | undefined;
  private constructor() {
    super(SERIALPORT_PROCESS.TOKEN_DISPENSER, TokenDispenserSerialSchemas);
  }

  public static getInstance(): TokenDispenser {
    if (!TokenDispenser.instance) {
      TokenDispenser.instance = new TokenDispenser();
    }
    return TokenDispenser.instance;
  }
}
