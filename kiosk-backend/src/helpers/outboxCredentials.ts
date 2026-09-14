import { processManager } from '@processManager/Manager';
import { SERIALPORT_PROCESS } from 'kiosk-types';
import { OUTBOX_EVENTS } from 'src/hardwareTransport/events/Outbox';
import { Outbox } from 'src/hardwareTransport/Outbox';
import { LogService } from 'src/service/LogService';
import { PermissionService } from 'src/service/PermissionService';

/** 빌드 타임에 박히는 값(esbuild define). 렌더러의 VITE_API_HOST 와 같은 서버다. */
const API_HOST = process.env.API_HOST ?? '';

const graphqlEndpoint = (): string | null =>
  API_HOST ? `${API_HOST}/graphql` : null;

/**
 * outbox 가 원격에 말을 걸 자격을 넘긴다.
 *
 * 토큰의 **유일한 출처는 백엔드의 secure storage** 다. 렌더러를 경유시키면 같은 비밀이
 * 한 곳 더 생기고, 렌더러가 떠 있어야만 큐가 도는 토폴로지가 된다.
 *
 * 자격이 없어도 부팅을 막지 않는다 — outbox 는 묻지 못하는 동안 행을 deferred 로 두고
 * 시도를 소모하지 않는다. 로그인 전 키오스크가 정확히 그 상태다.
 */
export async function pushOutboxCredentials(): Promise<void> {
  const logger = LogService.getInstance();

  const endpoint = graphqlEndpoint();
  if (!endpoint) {
    logger.info('[Outbox] API_HOST 미설정 — 자격을 넘기지 않는다');
    return;
  }

  const token = await new PermissionService().getToken();
  if (!token) {
    logger.info('[Outbox] 토큰 없음 — 로그인 후 다시 넘긴다');
    return;
  }

  const result = await Outbox.getInstance().request(
    OUTBOX_EVENTS.SET_CREDENTIALS,
    { endpoint, token },
  );

  if (result.success) {
    logger.info('[Outbox] 자격 전달 완료');
    return;
  }
  logger.error(`[Outbox] 자격 전달 거절: ${result.cause}`);
}

/**
 * outbox 가 **다시 뜰 때마다** 자격을 밀어준다.
 *
 * 자격은 그 프로세스 메모리에만 있으므로(의도한 설계 — 토큰 사본을 디스크에 만들지
 * 않는다) 크래시·HMR·파이프 경합으로 재기동하면 통째로 사라진다. 그러면 스케줄러는
 * 계속 돌지만 executor 가 매번 "아직 물어볼 수 없다"로 되돌려 보내고, deferred 는
 * 시도를 소모하지 않으므로 **큐가 조용히 멈춘다** — 에러도 안 나고 아무것도 안 나간다.
 * 실측으로 그 상태를 확인했다.
 *
 * 등록하는 쪽이 outbox 인 이유는 방향이다: processManager 가 이 모듈을 알면
 * 트랜스포트를 거쳐 자기 자신으로 돌아온다.
 */
export function startOutboxCredentialSync(): void {
  processManager.onSpawned((spawned) => {
    if (spawned !== SERIALPORT_PROCESS.OUTBOX) return;

    void pushOutboxCredentials().catch((e) => {
      LogService.getInstance().error('[Outbox] 재기동 후 자격 전달 실패:', e);
    });
  });
}
