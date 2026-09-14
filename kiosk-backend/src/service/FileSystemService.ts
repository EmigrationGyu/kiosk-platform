import fs from 'fs';
import type { Result } from 'kiosk-types';
import path from 'path';
import { ERROR_CODE } from '../constant/ErrorCodes';
import { KIOSK_HOME_DIR } from '../constant/LogPaths';

// 파일 읽기 실패 원인(닫힌 집합). readFile 이 예외 대신 Result 로 올리므로, 호출부는
// 필요한 원인만 골라 처리한다 — 예: 색 보정 CSV 는 FILE_NOT_FOUND 를 정상(null)으로,
// Suprema 이미지는 어떤 실패든 에러로 취급.
export const FS_CAUSE = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  INVALID_PATH: 'INVALID_PATH',
  READ_FAILED: 'READ_FAILED',
} as const;

export type FsCause = (typeof FS_CAUSE)[keyof typeof FS_CAUSE];

// 보안(XSS 등으로 인한 임의 경로 쓰기 방지)을 위해 허용된 경로만 저장 대상이 됨.
// 정적으로 선언된 기본 루트 외에, 런타임에 동적으로 추가해야 하는 경로
// (예: DaouVP 설치 폴더 — 버전별로 위치가 다름) 는 `registerAllowedRoot` 로 등록한다.
// 저장은 항상 normalize 된 형태로 하여, saveFile 에서 매 호출마다 re-normalize 하는 비용 제거.
// KIOSK_HOME_DIR: 이 단말의 데이터 루트(~/.kiosk) — 인증 자료(auth/: 약관 서명
// 쓰기, Suprema staging 읽기/삭제)와 설정(config/: 색 보정 CSV 읽기)이 모두 이 아래에서
// 일어난다. 쓰기 목적지는 컨트롤러의 닫힌 집합 토큰으로 별도 제한되므로, 루트를 넓혀도
// 렌더러가 임의 경로에 쓸 수는 없다.
const DEFAULT_ALLOWED_ROOTS = [KIOSK_HOME_DIR];

class FileSystemService {
  private readonly allowedRoots: string[] = DEFAULT_ALLOWED_ROOTS.map((r) =>
    this.normalizeKey(r),
  );

  /**
   * 런타임에 발견되는 쓰기 허용 경로를 추가. 멱등(중복 등록 시 무시).
   * 호출 예: DaouVPTerminal 이 DaouVP 설치 폴더를 탐색한 뒤 등록.
   */
  registerAllowedRoot(root: string): void {
    const normalized = this.normalizeKey(root);
    if (!this.allowedRoots.includes(normalized)) {
      this.allowedRoots.push(normalized);
    }
  }

  async saveFile(filePath: string, fileName: string, data: any) {
    try {
      const normalizedFilePath = this.normalizeKey(filePath);
      if (
        !this.allowedRoots.some((allowed) =>
          normalizedFilePath.includes(allowed),
        )
      ) {
        throw new Error('Invalid path');
      }

      const root = filePath;
      const safeName = this.sanitizeFileName(fileName);
      const dist = path.resolve(root, safeName);

      this.assertAllowedPath(root, dist);

      fs.mkdirSync(root, { recursive: true });
      const bufferData = data instanceof ArrayBuffer ? Buffer.from(data) : data;
      fs.writeFileSync(dist, bufferData);
    } catch (error) {
      console.error(error);
      throw new Error(error as string);
    }
  }

  /**
   * 허용된 루트 안의 파일을 읽어 Buffer 로 반환한다. 예외 대신 프로젝트 Result 봉투로 올린다 —
   * 파일 없음(FILE_NOT_FOUND)은 에러가 아니라 도메인 결과이므로(예: 미보정 현장의 색 보정 CSV,
   * OCR 을 안 타는 Suprema 전용 단말), 호출부가 성공/없음/실패를 타입으로 분기한다.
   * (예: Suprema 신분증 이미지 읽기, 색 보정 CSV 읽기)
   */
  async readFile(filePath: string): Promise<Result<Buffer, FsCause>> {
    const normalized = this.normalizeKey(filePath);
    if (!this.allowedRoots.some((allowed) => normalized.includes(allowed))) {
      return {
        success: false,
        cause: FS_CAUSE.INVALID_PATH,
        code: ERROR_CODE.BAD_REQUEST,
      };
    }
    try {
      return { success: true, data: await fs.promises.readFile(filePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          success: false,
          cause: FS_CAUSE.FILE_NOT_FOUND,
          code: ERROR_CODE.NOT_FOUND,
        };
      }
      return {
        success: false,
        cause: FS_CAUSE.READ_FAILED,
        code: ERROR_CODE.INTERNAL_SERVER_ERROR,
      };
    }
  }

  /** 허용된 루트 안의 파일을 삭제한다. (예: 읽어서 다른 곳에 영속화한 staging 파일 정리) */
  async deleteFile(filePath: string): Promise<void> {
    const normalized = this.normalizeKey(filePath);
    if (!this.allowedRoots.some((allowed) => normalized.includes(allowed))) {
      throw new Error('Invalid path');
    }
    await fs.promises.rm(filePath, { force: true });
  }

  private sanitizeFileName(name: string) {
    const base = path.basename(name);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 0x00-0x1F 는 Windows 파일명 금지문자 규격 그 자체다
    return base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  }

  private assertAllowedPath(root: string, fullPath: string) {
    const r = path.resolve(root).toLowerCase();
    const f = path.resolve(fullPath).toLowerCase();

    if (f !== r && !f.startsWith(r + path.sep)) {
      throw new Error('Invalid path');
    }
  }

  private normalizeKey(p: string) {
    return path
      .resolve(p)
      .trim()
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  }
}

export default new FileSystemService();
