import {
  type Manifest,
  type Pointer,
  type RollbackIntent,
  type RollbackStack,
  rollbackManifest,
  topRollback,
} from 'kiosk-types';

/**
 * 롤백 지시를 무엇으로 풀 것인가 — 순수 판정.
 *
 * - `components`: 같은 셸 안. 스택 top 을 매니페스트로 펴서 평범한 적용 경로를 탄다.
 * - `reinstall`: top 이 다른 설치본에서 돌던 조합. 그 설치본을 먼저 깔고, 다시 뜬 앱이
 *   intent 를 읽어 컴포넌트를 이어서 놓는다(`installing` 정산과 같은 패턴).
 * - `decline`: 되돌릴 곳이 없다.
 */
export type RollbackPlan =
  | { kind: 'decline'; detail: string }
  | { kind: 'components'; manifest: Manifest }
  | { kind: 'reinstall'; manifest: Manifest; intent: RollbackIntent };

export function planRollback(input: {
  stack: RollbackStack;
  live: Pointer;
  appVersion: string;
  commandId: string | null;
}): RollbackPlan {
  const target = topRollback(input.stack);
  if (target === null) {
    return { kind: 'decline', detail: '되돌릴 조합이 없습니다' };
  }
  if (target.base !== input.appVersion) {
    return {
      kind: 'reinstall',
      manifest: { manifestVersion: 1, components: {}, base: target.base },
      intent: { commandId: input.commandId, target },
    };
  }
  return {
    kind: 'components',
    manifest: rollbackManifest(target, input.live),
  };
}

/**
 * 다시 뜬 앱이 intent 를 어떻게 마무리할 것인가.
 *
 * 설치본이 목적지와 같으면 컴포넌트를 이어서 놓는다. 다르면 설치가 일어나지 않은
 * 것이라 폐기한다 — 스택은 그대로라 운영자가 다시 누르면 된다.
 */
export function planResume(input: {
  intent: RollbackIntent;
  live: Pointer;
  appVersion: string;
}): Manifest | null {
  if (input.intent.target.base !== input.appVersion) return null;
  return rollbackManifest(input.intent.target, input.live);
}
