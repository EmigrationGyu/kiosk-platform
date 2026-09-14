import type { RemoteCredentials } from './GraphQLExecutor';

/**
 * 이 프로세스가 원격에 말을 걸 자격의 보관소.
 *
 * **메모리에만 둔다.** 토큰을 디스크에 쓰면 이 프로세스가 자격증명의 두 번째 사본을
 * 갖게 되고, 백엔드의 secure storage 가 유일한 출처라는 사실이 깨진다. 재기동하면
 * 비어 있고, 백엔드가 부팅 때 다시 넘긴다 — 그동안은 실패가 아니라 그냥 묻지 않는다.
 */
export type CredentialStore = {
  set(credentials: RemoteCredentials): void;
  get(): RemoteCredentials | undefined;
};

export function createCredentialStore(): CredentialStore {
  let current: RemoteCredentials | undefined;

  return {
    set(credentials) {
      current = credentials;
    },
    get() {
      return current;
    },
  };
}
