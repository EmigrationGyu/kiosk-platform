import { BRIDGE_METHOD, type BridgeMethod } from 'kiosk-types';
import type { BridgeClient } from '../types';

/**
 * **부모가 없는 호스트**의 브리지 — 개발(node 타깃)과 앞으로의 독립 실행용.
 *
 * 이 토폴로지엔 능력을 빌려줄 부모가 없다. 예전엔 그 사실이 `bridge()` 의 throw 로만
 * 드러났는데, 렌더러의 생존 선언은 **성공할 때까지 5초마다 재시도**하므로 개발 세션 내내
 * 같은 에러가 쌓였다(실측: 하루 에러 262줄 중 231줄이 이것이었다).
 *
 * 부재를 실패로 번역한 게 잘못이었다. 갈리는 것은 **부모가 없다는 사실의 의미**다.
 */

/**
 * 부모에게 **알리기만 하는** 호출 — 부모의 워치독·포인터를 갱신할 뿐, 부르는 쪽이 기다리는
 * 결과가 없다. 받을 상대가 없으면 할 일이 없으므로 성공으로 끝난다.
 *
 * 그 밖의 호출(`UPDATE_APPLY` 등)은 부모가 **대행하는 일**이라, 부모가 없으면 실패가
 * 사실이다. 조용히 성공시키면 호출부가 적용됐다고 믿고 잠금을 유지한 채 교체를 기다린다.
 */
const NOTIFY_ONLY: ReadonlySet<BridgeMethod> = new Set([
  BRIDGE_METHOD.RENDERER_ALIVE,
  BRIDGE_METHOD.UPDATE_MARK_STABLE,
  BRIDGE_METHOD.UPDATE_ROLLBACK,
  BRIDGE_METHOD.UPDATE_REPORTED,
]);

/** 부모 없이도 성립하는 호출인가. */
export const survivesWithoutParent = (method: BridgeMethod): boolean =>
  NOTIFY_ONLY.has(method);

const client: BridgeClient = {
  call(method) {
    if (!survivesWithoutParent(method)) {
      return Promise.reject(
        new Error(
          `부모 없는 토폴로지에서는 ${method} 를 대행할 상대가 없습니다.`,
        ),
      );
    }
    return Promise.resolve({ value: undefined, port: null });
  },
  // 아래 둘은 부모가 있는 토폴로지의 impl(channel/messagePort · processManager/bridge)에서만
  // 불린다. 그것들은 이 타깃에서 alias 로 치환돼 빠지므로 여기 닿을 길이 없다 — 닿았다면
  // 배선이 어긋난 것이라 조용히 넘기지 않는다.
  onRendererPort() {
    throw new Error('부모 없는 토폴로지에는 건네받을 렌더러 포트가 없습니다.');
  },
  onProcessEvent() {
    throw new Error('부모 없는 토폴로지에서는 자식을 직접 띄웁니다.');
  },
};

export function bridge(): BridgeClient {
  return client;
}
