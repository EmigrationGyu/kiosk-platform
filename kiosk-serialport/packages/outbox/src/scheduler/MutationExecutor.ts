import type { OutboxMutationRow } from '../db';

/**
 * 원격 GraphQL 서버에 mutation 한 건을 실제 호출하는 추상 인터페이스.
 *
 * 네 갈래는 **봉투가 왔는가**로 먼저 갈린다 — 이 축을 접으면 오프라인이 시도를 까먹어 큐를 통째로
 * DEAD 로 만든다.
 *   `success` → markSuccess
 *   `transient_failure` → markFailure  (서버가 답했다. attempts++ 후 지수 백오프)
 *   `permanent_failure` → markDead     (서버가 거절했다. 재시도 무의미)
 *   `deferred` → markDeferred          (묻지 못했다. attempts 보존, 짧게 재시도)
 */
export type MutationExecutionResult =
  | { kind: 'success' }
  | { kind: 'transient_failure'; error: string }
  | { kind: 'permanent_failure'; error: string }
  | { kind: 'deferred'; reason: string };

export interface MutationExecutor {
  execute(row: OutboxMutationRow): Promise<MutationExecutionResult>;
}

/**
 * 기본 executor — 아직 주입되지 않은 상태. throw 하지 않는다: executor 부재는 이 행이 실패한 게 아니라
 * 아직 물어볼 수단이 없다는 뜻이라, 실패로 번역하면 배선이 덜 된 동안 큐가 조용히 소진된다.
 */
export class UnconfiguredExecutor implements MutationExecutor {
  async execute(_row: OutboxMutationRow): Promise<MutationExecutionResult> {
    return {
      kind: 'deferred',
      reason: 'MutationExecutor not configured — inject one before start().',
    };
  }
}
