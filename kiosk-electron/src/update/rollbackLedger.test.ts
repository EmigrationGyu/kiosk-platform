import { describe, expect, test } from 'bun:test';
import type { Pointer } from 'kiosk-types/src/update/generation';
import {
  EMPTY_ROLLBACK_STACK,
  type RollbackStack,
} from 'kiosk-types/src/update/rollbackStack';
import { createRollbackLedger } from './rollbackLedger';
import type { RollbackStackStore } from './rollbackStackStore';

const memory = (initial: RollbackStack = EMPTY_ROLLBACK_STACK) => {
  let current = initial;
  let writes = 0;
  const store: RollbackStackStore = {
    read: () => current,
    write: (stack) => {
      current = stack;
      writes += 1;
    },
  };
  return { store, get: () => current, writes: () => writes };
};

const live = (components: Pointer['components']): Pointer => ({
  pointerVersion: 1,
  components,
});

const ledger = (stack: ReturnType<typeof memory>, appVersion = '2.0.0') =>
  createRollbackLedger({
    stack: stack.store,
    appVersion,
    now: () => '2026-09-03T00:00:00Z',
  });

const APPLY = { kind: 'apply', commandId: 'a' } as const;
const ROLLBACK = { kind: 'rollback', commandId: 'r' } as const;

describe('applied — 컴포넌트 적용이 끝났을 때', () => {
  test('apply 가 무언가 갈았으면 바뀌기 전 포인터를 push 한다', () => {
    const stack = memory();
    ledger(stack).applied(APPLY, live({ backend: 'b1' }), ['backend']);
    expect(stack.get().entries).toEqual([
      {
        base: '2.0.0',
        components: { backend: 'b1' },
        commandId: 'a',
        at: '2026-09-03T00:00:00Z',
      },
    ]);
  });

  test('apply 가 아무것도 안 갈았으면 push 하지 않는다 — 밀어낸 것이 없다', () => {
    const stack = memory();
    ledger(stack).applied(APPLY, live({ backend: 'b1' }), []);
    expect(stack.get()).toEqual(EMPTY_ROLLBACK_STACK);
    expect(stack.writes()).toBe(0);
  });

  test('rollback 은 갈린 것이 있으면 pop', () => {
    const stack = memory();
    const l = ledger(stack);
    l.applied(APPLY, live({}), ['backend']);
    l.applied(ROLLBACK, live({ backend: 'b1' }), ['backend']);
    expect(stack.get().entries).toEqual([]);
  });

  test('rollback 은 갈린 것이 없어도 pop ★ — 남기면 다음 롤백이 영영 같은 자리에서 거절된다', () => {
    const stack = memory();
    const l = ledger(stack);
    l.applied(APPLY, live({}), ['backend']);
    l.applied({ ...APPLY, commandId: 'b' }, live({ backend: 'b1' }), [
      'backend',
    ]);
    l.applied(ROLLBACK, live({ backend: 'b1' }), []); // top 이 이미 지금 조합
    expect(stack.get().entries.map((e) => e.commandId)).toEqual(['a']);
  });

  test('rollback 은 push 하지 않는다 — 되돌린 걸 다시 올리는 건 평범한 배포다', () => {
    const stack = memory();
    const l = ledger(stack);
    l.applied(APPLY, live({}), ['backend']);
    l.applied(ROLLBACK, live({ backend: 'b1' }), ['backend']);
    l.applied({ ...ROLLBACK, commandId: 'r2' }, live({}), []);
    expect(stack.get()).toEqual(EMPTY_ROLLBACK_STACK); // 두 번째 rollback 은 빈 스택에 no-op
  });

  test('하네스 지시는 commandId 가 null 이어도 남는다', () => {
    const stack = memory();
    ledger(stack).applied({ kind: 'apply', commandId: null }, live({}), ['x']);
    expect(stack.get().entries[0]?.commandId).toBeNull();
  });
});

describe('handedOff — 설치본에 넘기기 직전', () => {
  test('apply 는 push — 넘긴 뒤엔 우리가 없다', () => {
    const stack = memory();
    ledger(stack, '1.0.0').handedOff(APPLY, live({ backend: 'b1' }));
    expect(stack.get().entries).toEqual([
      {
        base: '1.0.0',
        components: { backend: 'b1' },
        commandId: 'a',
        at: '2026-09-03T00:00:00Z',
      },
    ]);
  });

  test('rollback 은 pop 하지 않는다 ★ — 설치가 안 일어나면 다시 누를 수 있어야 한다', () => {
    const stack = memory();
    const l = ledger(stack);
    l.applied(APPLY, live({}), ['backend']);
    l.handedOff(ROLLBACK, live({ backend: 'b1' }));
    expect(stack.get().entries.map((e) => e.commandId)).toEqual(['a']);
    expect(stack.writes()).toBe(1);
  });
});

describe('연속 롤백', () => {
  test('두 번이면 두 칸 내려간다', () => {
    const stack = memory();
    const l = ledger(stack);
    l.applied(APPLY, live({}), ['backend']);
    l.applied({ ...APPLY, commandId: 'b' }, live({ backend: 'b1' }), [
      'backend',
    ]);
    l.applied(ROLLBACK, live({ backend: 'b2' }), ['backend']);
    expect(stack.get().entries.map((e) => e.commandId)).toEqual(['a']);
    l.applied({ ...ROLLBACK, commandId: 'r2' }, live({ backend: 'b1' }), [
      'backend',
    ]);
    expect(stack.get().entries).toEqual([]);
  });
});

describe('정리 보호', () => {
  test('지금 셸의 항목이 붙드는 세대만 돌려준다', () => {
    const stack = memory();
    const l = ledger(stack, '2.0.0');
    l.applied(APPLY, live({ backend: 'b1' }), ['backend']);
    expect(l.held('backend')).toEqual(['b1']);
    expect(ledger(stack, '3.0.0').held('backend')).toEqual([]);
  });
});
