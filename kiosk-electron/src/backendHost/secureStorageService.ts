import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, safeStorage } from 'electron';

/**
 * 백엔드가 빌려 쓰는 safeStorage — 자식 프로세스에서는 호출 자체가 불가능한 능력이다.
 *
 * 암복호화와 파일 쓰기를 **한 왕복에 묶는다**: 암복호화만 빌려주면 왕복이 두 번이 되고 그 사이
 * 프로세스가 죽으면 반쯤 쓴 상태가 남는다. 경로·파일명은 기존 in-process 구현과 **동일하게**
 * 유지한다 — 이미 배포된 단말의 `.enc` 를 그대로 읽어야 재로그인이 필요 없다.
 */
const storageDir = (): string =>
  path.join(app.getPath('userData'), 'secure-storage');

/** service+account 조합에서 파일명 생성 (특수문자 제거) — 기존 규칙 그대로. */
export const secureFileName = (service: string, account: string): string =>
  `${`${service}_${account}`.replace(/[^a-zA-Z0-9_-]/g, '_')}.enc`;

const filePath = (service: string, account: string): string =>
  path.join(storageDir(), secureFileName(service, account));

export const secureStorageService = {
  set(service: string, account: string, password: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available');
    }
    fs.mkdirSync(storageDir(), { recursive: true });
    fs.writeFileSync(
      filePath(service, account),
      safeStorage.encryptString(password),
    );
  },

  get(service: string, account: string): string | null {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available');
    }
    const target = filePath(service, account);
    if (!fs.existsSync(target)) return null;
    return safeStorage.decryptString(fs.readFileSync(target));
  },

  delete(service: string, account: string): boolean {
    const target = filePath(service, account);
    if (!fs.existsSync(target)) return false;
    fs.unlinkSync(target);
    return true;
  },
};
