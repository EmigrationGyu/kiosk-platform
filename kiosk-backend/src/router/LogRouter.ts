import { LogSchemas } from 'src/constant/events/Log';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class LogRouter extends Router<typeof NAMESPACES.LOG> {
  constructor() {
    super(NAMESPACES.LOG, LogSchemas);
  }
}
