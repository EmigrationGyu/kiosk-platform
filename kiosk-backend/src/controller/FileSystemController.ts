import path from 'path';
import FileSystemService, { FS_CAUSE } from 'src/service/FileSystemService';
import { withErrorHandler } from 'src/utils/errorHandler';
import {
  CONFIG_FILE_NAMES,
  FILESYSTEM_EVENTS,
  type FileSystemEventMap,
  READ_SOURCES,
  type ReadSource,
  SAVE_DIRECTORIES,
  type SaveDirectory,
} from '../constant/events/FileSystem';
import {
  KIOSK_AUTH_SIGNATURE_DIR,
  KIOSK_CONFIG_DIR,
} from '../constant/LogPaths';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { BaseController, type ControllerHandlers } from './BaseController';

// 프론트가 보내는 목적지 토큰(닫힌 집합) → 실제 디스크 경로. 경로는 백엔드만 안다.
const SAVE_DIRECTORY_PATHS = {
  [SAVE_DIRECTORIES.AUTH_SIGNATURE]: KIOSK_AUTH_SIGNATURE_DIR,
  [SAVE_DIRECTORIES.CONFIG]: KIOSK_CONFIG_DIR,
} as const satisfies Record<SaveDirectory, string>;

// 읽기 소스 토큰(닫힌 집합) → 실제 파일 경로. SAVE 와 대칭 — 렌더러는 토큰만 안다.
const READ_SOURCE_PATHS = {
  [READ_SOURCES.COLOR_CALIBRATION]: path.join(
    KIOSK_CONFIG_DIR,
    'color-calibration.csv',
  ),
  // 파일명은 types 의 단일 출처를 쓴다 — 프론트의 쓰기와 같은 파일을 가리켜야 한다.
  [READ_SOURCES.CAMERA_ASSIGNMENT]: path.join(
    KIOSK_CONFIG_DIR,
    CONFIG_FILE_NAMES.CAMERA,
  ),
} as const satisfies Record<ReadSource, string>;

export class FileSystemController extends BaseController<FileSystemEventMap> {
  private fileSystemService = FileSystemService;

  constructor() {
    const handlers = {
      [FILESYSTEM_EVENTS.SAVE]: withErrorHandler(async (req, res) => {
        await this.fileSystemService.saveFile(
          SAVE_DIRECTORY_PATHS[req.directory],
          req.fileName,
          req.data,
        );
        return res.ok(SUCCESS_CODE.OK);
      }, 'Failed to save file'),

      [FILESYSTEM_EVENTS.READ]: withErrorHandler(async (req, res) => {
        const result = await this.fileSystemService.readFile(
          READ_SOURCE_PATHS[req.source],
        );
        if (!result.success) {
          // 파일 없음은 에러가 아니라 정상(미보정 현장/OCR 을 안 타는 단말) → null 로 흘려보낸다.
          if (result.cause === FS_CAUSE.FILE_NOT_FOUND) {
            return res.ok(SUCCESS_CODE.OK, null);
          }
          return res.error(result.code, result.cause);
        }
        return res.ok(SUCCESS_CODE.OK, result.data.toString('utf-8'));
      }, 'Failed to read file'),
    } satisfies ControllerHandlers<FileSystemEventMap>;
    super(handlers);
  }
}
