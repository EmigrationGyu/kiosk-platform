import { bridge } from '@bridge/Bridge';
import { BRIDGE_METHOD } from 'kiosk-types';
import type { SecureStorage } from '../types';

/**
 * 자식 프로세스용 SecureStorage — 실제 암복호화는 부모의 electron safeStorage 가 한다.
 *
 * 계약이 이미 전부 Promise 라 RPC 로 옮겨도 소비처(PermissionService)는 변하지 않는다.
 * 이건 electron 에서만 가능한 능력이라 브리지를 통하는 게 맞다 — 값이 아니라 동작이므로
 * env 주입으로는 표현할 수 없다.
 */
export const secureStorage: SecureStorage = {
  async setPassword(service, account, password) {
    await bridge().call(BRIDGE_METHOD.SECURE_SET, service, account, password);
  },
  async getPassword(service, account) {
    const { value } = await bridge().call(
      BRIDGE_METHOD.SECURE_GET,
      service,
      account,
    );
    return value as string | null;
  },
  async deletePassword(service, account) {
    const { value } = await bridge().call(
      BRIDGE_METHOD.SECURE_DELETE,
      service,
      account,
    );
    return value as boolean;
  },
};
