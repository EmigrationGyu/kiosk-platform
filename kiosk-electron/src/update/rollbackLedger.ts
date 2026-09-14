import type { UpdateComponent } from 'kiosk-types/src/update/components';
import type {
  ApplyInstruction,
  Pointer,
} from 'kiosk-types/src/update/generation';
import {
  generationsHeldBy,
  popRollback,
  pushRollback,
} from 'kiosk-types/src/update/rollbackStack';
import type { RollbackStackStore } from './rollbackStackStore';

type Instruction = Pick<ApplyInstruction, 'kind' | 'commandId'>;

/**
 * 되돌림 스택의 정책 — 어느 지시가 무엇을 밀어냈는가. 자동 되감기(descend)는 여기 오지
 * 않는다: 스택은 운영자 지시의 기록이지 안전장치의 기록이 아니다. electron 을 모른다.
 */
export type RollbackLedger = {
  /**
   * 컴포넌트 적용이 끝났다. apply 는 갈린 것이 있을 때만 push — 아무것도 안 바뀐 지시는
   * 밀어낸 것이 없다. rollback 은 갈린 것이 없어도 pop — 남겨두면 다음 롤백이 영영 같은
   * 자리에서 거절된다.
   */
  applied(
    instruction: Instruction,
    before: Pointer,
    changed: readonly string[],
  ): void;
  /**
   * 앱 설치본에 넘긴다 — 넘긴 뒤엔 우리가 없으므로 넘기기 **전에** 부른다. apply 는 push,
   * rollback 은 pop 하지 않는다(다시 뜬 앱이 컴포넌트까지 놓은 뒤 pop). 설치가 안 일어나면
   * 스택이 그대로라 운영자가 다시 누르면 된다.
   */
  handedOff(instruction: Instruction, before: Pointer): void;
  /** 정리(prune)가 지우면 안 되는 세대 — 지금 셸의 항목이 붙드는 것. */
  held(component: UpdateComponent): string[];
};

export function createRollbackLedger(deps: {
  stack: RollbackStackStore;
  /** 지금 앱 설치본 버전 — 밀려난 조합이 돌던 셸. */
  appVersion: string;
  now?: () => string;
}): RollbackLedger {
  const now = deps.now ?? (() => new Date().toISOString());

  const push = (instruction: Instruction, before: Pointer) =>
    deps.stack.write(
      pushRollback(deps.stack.read(), {
        base: deps.appVersion,
        components: before.components,
        commandId: instruction.commandId,
        at: now(),
      }),
    );
  const pop = () => deps.stack.write(popRollback(deps.stack.read()));

  return {
    applied(instruction, before, changed) {
      if (instruction.kind === 'rollback') pop();
      else if (changed.length > 0) push(instruction, before);
    },

    handedOff(instruction, before) {
      if (instruction.kind === 'apply') push(instruction, before);
    },

    held: (component) =>
      generationsHeldBy(deps.stack.read(), deps.appVersion, component),
  };
}
