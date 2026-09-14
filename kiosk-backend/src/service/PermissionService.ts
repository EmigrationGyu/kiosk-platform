import { secureStorage } from '@storage/SecureStorage';
import { LogService } from './LogService';

/**
 * 환경에 따라 다른 보안 저장소로 토큰을 저장한다.
 * - 개발(npm run start): keytar → OS 보안 저장소(Windows Credential Manager / Keychain / libsecret)
 * - 프로덕션(npm run build): Electron safeStorage 로 암호화된 파일
 */
export class PermissionService {
  private static readonly SERVICE_NAME = 'kiosk';
  private static readonly TOKEN_ACCOUNT = 'auth-token';
  private logger = LogService.getInstance();

  async saveToken(token: string): Promise<void> {
    try {
      await secureStorage.setPassword(
        PermissionService.SERVICE_NAME,
        PermissionService.TOKEN_ACCOUNT,
        token,
      );
      this.logger.info('[인증] 키오스크 토큰 저장 완료');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.errorOf(error);
      } else {
        this.logger.error('Failed to save token to secure storage');
      }
      throw new Error('Failed to save token securely');
    }
  }

  async getToken(): Promise<string | null> {
    try {
      const token = await secureStorage.getPassword(
        PermissionService.SERVICE_NAME,
        PermissionService.TOKEN_ACCOUNT,
      );

      if (token) {
        this.logger.info('[인증] 키오스크 토큰 조회 성공');
      } else {
        this.logger.info('[인증] 키오스크 토큰 없음 (로그인 필요)');
      }

      return token;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.errorOf(error);
      } else {
        this.logger.error('Failed to retrieve token from secure storage');
      }
      throw new Error('Failed to retrieve token securely');
    }
  }

  async deleteToken(): Promise<boolean> {
    try {
      const deleted = await secureStorage.deletePassword(
        PermissionService.SERVICE_NAME,
        PermissionService.TOKEN_ACCOUNT,
      );

      if (deleted) {
        this.logger.info('Token deleted successfully from secure storage');
      } else {
        this.logger.info('No token to delete in secure storage');
      }

      return deleted;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.errorOf(error);
      } else {
        this.logger.error('Failed to delete token from secure storage');
      }
      throw new Error('Failed to delete token securely');
    }
  }

  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}
