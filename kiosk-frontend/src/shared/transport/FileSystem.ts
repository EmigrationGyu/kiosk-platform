import { Transport } from 'transport/Transport';
import type { FileSystemEventMap } from '../constants/events/FileSystem';
import { FileSystemResponseSchemas } from '../constants/events/FileSystem';
import { NAMESPACES } from '../constants/Namespaces';

export class FileSystem extends Transport<FileSystemEventMap> {
  public constructor() {
    super(NAMESPACES.FILESYSTEM, FileSystemResponseSchemas);
  }
}
