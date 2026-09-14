import keytar from 'keytar';
import type { SecureStorage } from '../types';

/**
 * Keytar 기반 SecureStorage 구현
 *
 * 개발 환경에서 사용됩니다.
 * OS 레벨의 보안 저장소를 사용합니다:
 * - Windows: Windows Credential Manager
 * - macOS: Keychain
 * - Linux: libsecret (GNOME Keyring)
 */
class KeytarStorage implements SecureStorage {
  async setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void> {
    await keytar.setPassword(service, account, password);
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    return await keytar.getPassword(service, account);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return await keytar.deletePassword(service, account);
  }
}

export const secureStorage: SecureStorage = new KeytarStorage();
