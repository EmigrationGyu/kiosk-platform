import { describe, expect, test } from 'bun:test';
import {
  BASELINE_GENERATION,
  EMPTY_ROLLBACK_STACK,
  type Pointer,
  pushRollback,
  type RollbackEntry,
} from 'kiosk-types';
import { planResume, planRollback } from './rollbackPlan';

const entry = (
  base: string,
  components: RollbackEntry['components'],
): RollbackEntry => ({ base, components, commandId: 'x', at: 't' });

const live = (components: Pointer['components']): Pointer => ({
  pointerVersion: 1,
  components,
});

describe('planRollback', () => {
  test('스택이 비면 거절', () => {
    const plan = planRollback({
      stack: EMPTY_ROLLBACK_STACK,
      live: live({}),
      appVersion: '2.0.0',
      commandId: 'r',
    });
    expect(plan.kind).toBe('decline');
  });

  test('같은 셸이면 top 을 매니페스트로 편다', () => {
    const stack = pushRollback(
      EMPTY_ROLLBACK_STACK,
      entry('2.0.0', { backend: 'b1' }),
    );
    const plan = planRollback({
      stack,
      live: live({ backend: 'b2', frontend: 'f2' }),
      appVersion: '2.0.0',
      commandId: 'r',
    });
    expect(plan).toEqual({
      kind: 'components',
      manifest: {
        manifestVersion: 1,
        components: { backend: 'b1', frontend: BASELINE_GENERATION },
      },
    });
  });

  test('다른 설치본이면 그 설치본을 먼저 깔고 intent 를 남긴다', () => {
    const target = entry('1.0.0', { backend: 'b1' });
    const stack = pushRollback(EMPTY_ROLLBACK_STACK, target);
    const plan = planRollback({
      stack,
      live: live({}),
      appVersion: '2.0.0',
      commandId: 'r',
    });
    expect(plan).toEqual({
      kind: 'reinstall',
      manifest: { manifestVersion: 1, components: {}, base: '1.0.0' },
      intent: { commandId: 'r', target },
    });
  });

  test('top 만 본다 — 아래 항목이 같은 셸이어도 top 이 다른 셸이면 설치가 먼저다', () => {
    let stack = pushRollback(
      EMPTY_ROLLBACK_STACK,
      entry('2.0.0', { backend: 'b0' }),
    );
    stack = pushRollback(stack, entry('1.0.0', { backend: 'b1' }));
    const plan = planRollback({
      stack,
      live: live({ backend: 'b2' }),
      appVersion: '2.0.0',
      commandId: 'r',
    });
    expect(plan.kind).toBe('reinstall');
  });

  test('top 이 이미 지금 조합이면 빈 매니페스트 — 부모가 pop 만 하고 끝난다', () => {
    const stack = pushRollback(
      EMPTY_ROLLBACK_STACK,
      entry('2.0.0', { backend: 'b1' }),
    );
    const plan = planRollback({
      stack,
      live: live({ backend: 'b1' }),
      appVersion: '2.0.0',
      commandId: 'r',
    });
    expect(plan).toEqual({
      kind: 'components',
      manifest: { manifestVersion: 1, components: {} },
    });
  });

  test('하네스 지시(commandId null)도 intent 에 그대로 실린다', () => {
    const stack = pushRollback(EMPTY_ROLLBACK_STACK, entry('1.0.0', {}));
    const plan = planRollback({
      stack,
      live: live({}),
      appVersion: '2.0.0',
      commandId: null,
    });
    expect(plan.kind === 'reinstall' && plan.intent.commandId).toBeNull();
  });
});

describe('planResume', () => {
  const target = entry('1.0.0', { backend: 'b1' });

  test('설치본이 목적지와 같으면 컴포넌트를 이어서 놓는다', () => {
    expect(
      planResume({
        intent: { commandId: 'r', target },
        live: live({}),
        appVersion: '1.0.0',
      }),
    ).toEqual({ manifestVersion: 1, components: { backend: 'b1' } });
  });

  test('다르면 설치가 일어나지 않은 것 — 폐기', () => {
    expect(
      planResume({
        intent: { commandId: 'r', target },
        live: live({}),
        appVersion: '2.0.0',
      }),
    ).toBeNull();
  });
});
