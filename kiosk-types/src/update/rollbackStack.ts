import { z } from 'zod';
import type { UpdateComponent } from './components';
import {
  BASELINE_GENERATION,
  GenerationMapSchema,
  type Manifest,
  type Pointer,
  resolveGeneration,
  UPDATABLE_COMPONENTS,
} from './generation';

/**
 * 되돌림 스택 — 운영자 롤백의 목적지.
 *
 * `last-stable` 과 다른 물건이다. stable 은 자동 안전장치(descend)의 목적지이고 성공한 배포는 곧
 * stable 이 되므로, 운영자가 "직전으로"를 원할 때는 이미 늦다. 이 스택은 지시가 조합을 밀어낼 때마다
 * **밀려난 조합**을 버전으로 기록한다 — 세대 디렉토리가 아니라 버전이라 앱 설치본이 갈려도 뜻이 남고,
 * 그래서 `resources/target` 이 아니라 홈 디렉토리에 둔다.
 */
export const ROLLBACK_STACK_FILE = 'rollback-stack.json';

/** 설치본을 넘는 롤백의 나머지 절반 — 다시 뜬 앱이 읽고 마무리한다. */
export const ROLLBACK_INTENT_FILE = 'pending-rollback.json';

/** 보관 깊이. 넘치면 오래된 것부터 버린다. */
export const ROLLBACK_STACK_DEPTH = 4;

export const RollbackEntrySchema = z.object({
  /** 이 조합이 돌던 앱 설치본 버전. */
  base: z.string().min(1),
  /** 그때의 live 포인터. 빠짐 = baseline. */
  components: GenerationMapSchema,
  /** 이 조합을 밀어낸 지시. 하네스처럼 서버 지시가 아니면 null. */
  commandId: z.string().nullable(),
  at: z.string(),
});

export type RollbackEntry = z.infer<typeof RollbackEntrySchema>;

export const RollbackStackSchema = z.object({
  stackVersion: z.literal(1),
  /** 오래된 것이 앞, 직전이 뒤. */
  entries: z.array(RollbackEntrySchema),
});

export type RollbackStack = z.infer<typeof RollbackStackSchema>;

export const EMPTY_ROLLBACK_STACK: RollbackStack = {
  stackVersion: 1,
  entries: [],
};

export const RollbackIntentSchema = z.object({
  /** 롤백 지시의 id — 마무리 결과를 이 지시에 맞댄다. */
  commandId: z.string().nullable(),
  target: RollbackEntrySchema,
});

export type RollbackIntent = z.infer<typeof RollbackIntentSchema>;

export function pushRollback(
  stack: RollbackStack,
  entry: RollbackEntry,
  depth = ROLLBACK_STACK_DEPTH,
): RollbackStack {
  return {
    stackVersion: 1,
    entries: [...stack.entries, entry].slice(-depth),
  };
}

export const topRollback = (stack: RollbackStack): RollbackEntry | null =>
  stack.entries.at(-1) ?? null;

export const popRollback = (stack: RollbackStack): RollbackStack => ({
  stackVersion: 1,
  entries: stack.entries.slice(0, -1),
});

/**
 * 항목을 지금 조합에 대한 매니페스트로 편다. 매니페스트는 "빠짐 = 그대로"라, 항목에 없고 live 에
 * 있는 컴포넌트는 `baseline` 을 **명시**해야 되돌아간다.
 */
export function rollbackManifest(
  entry: RollbackEntry,
  live: Pointer,
): Manifest {
  const target: Pointer = { pointerVersion: 1, components: entry.components };
  const components: Partial<Record<UpdateComponent, string>> = {};
  for (const component of UPDATABLE_COMPONENTS) {
    const wanted = resolveGeneration(target, component);
    if (wanted !== resolveGeneration(live, component)) {
      components[component] = wanted;
    }
  }
  return { manifestVersion: 1, components };
}

/**
 * 스택이 붙드는 세대 — 정리(prune)가 지우면 안 되는 것. 지금 셸의 항목만 본다: 다른 설치본의
 * 세대는 이 셸에 없고, 필요해지면 다시 받는다.
 */
export function generationsHeldBy(
  stack: RollbackStack,
  base: string,
  component: UpdateComponent,
): string[] {
  return stack.entries
    .filter((entry) => entry.base === base)
    .map((entry) => entry.components[component] ?? BASELINE_GENERATION);
}
