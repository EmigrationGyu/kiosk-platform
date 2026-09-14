import { Transport } from '@hardwareTransport/Transport';
import { SERIALPORT_PROCESS } from 'kiosk-types';
import type { OutboxEventMap } from './events/Outbox';
import { OutboxSchemas } from './events/Outbox';

export class Outbox extends Transport<OutboxEventMap> {
  private static instance: Outbox | undefined;
  private constructor() {
    super(SERIALPORT_PROCESS.OUTBOX, OutboxSchemas);
  }

  public static getInstance(): Outbox {
    if (!Outbox.instance) {
      Outbox.instance = new Outbox();
    }
    return Outbox.instance;
  }
}
