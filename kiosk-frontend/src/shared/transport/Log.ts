import { Transport } from 'transport/Transport';
import type { LogEventMap } from '../constants/events/Log';
import { LogResponseSchemas } from '../constants/events/Log';
import { NAMESPACES } from '../constants/Namespaces';

export class Log extends Transport<LogEventMap> {
  public constructor() {
    super(NAMESPACES.LOG, LogResponseSchemas);
  }
}
