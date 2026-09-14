import { FileSystemSchemas } from '../constant/events/FileSystem';
import { NAMESPACES } from '../constant/Namespaces';
import { Router } from './Router';

export class FileSystemRouter extends Router<typeof NAMESPACES.FILESYSTEM> {
  constructor() {
    super(NAMESPACES.FILESYSTEM, FileSystemSchemas);
  }
}
