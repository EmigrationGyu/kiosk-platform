/**
 * SecureStorage 인터페이스
 *
 * 환경에 따라 다른 구현체를 사용합니다:
 * - 개발 환경 (npm run start): keytar (OS 레벨 보안 저장소)
 * - 프로덕션 환경 (npm run build): electron safeStorage
 */
export interface SecureStorage {
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}
