import { describe, expect, test } from 'bun:test';
import { SERIALPORT_PROCESS } from '../serialport/processes';
import { UPDATE_COMPONENT } from './components';
import {
  BASELINE_GENERATION,
  INITIAL_POINTER,
  type Pointer,
} from './generation';
import {
  EMPTY_ROLLBACK_STACK,
  generationsHeldBy,
  popRollback,
  pushRollback,
  ROLLBACK_STACK_DEPTH,
  type RollbackEntry,
  RollbackStackSchema,
  rollbackManifest,
  topRollback,
} from './rollbackStack';

const entry = (
  base: string,
  components: RollbackEntry['components'],
  commandId: string | null = 'cmd',
): RollbackEntry => ({
  base,
  components,
  commandId,
  at: '2026-09-03T00:00:00Z',
});

const live = (components: Pointer['components']): Pointer => ({
  pointerVersion: 1,
  components,
});

describe('스택', () => {
  test('직전이 top 이다', () => {
    const stack = pushRollback(
      pushRollback(EMPTY_ROLLBACK_STACK, entry('1.0.0', {})),
      entry('1.0.0', { backend: 'b1' }),
    );
    expect(topRollback(stack)?.components).toEqual({ backend: 'b1' });
  });

  test('pop 은 한 단계씩 내려간다 — 연달아 누르면 계속 내려간다', () => {
    let stack = pushRollback(EMPTY_ROLLBACK_STACK, entry('1.0.0', {}));
    stack = pushRollback(stack, entry('1.0.0', { backend: 'b1' }));
    stack = popRollback(stack);
    expect(topRollback(stack)?.components).toEqual({});
    stack = popRollback(stack);
    expect(topRollback(stack)).toBeNull();
    expect(topRollback(popRollback(stack))).toBeNull();
  });

  test('깊이를 넘치면 오래된 것부터 버린다', () => {
    let stack = EMPTY_ROLLBACK_STACK;
    for (let at = 0; at <= ROLLBACK_STACK_DEPTH; at += 1) {
      stack = pushRollback(stack, entry('1.0.0', { backend: `b${at}` }));
    }
    expect(stack.entries).toHaveLength(ROLLBACK_STACK_DEPTH);
    expect(stack.entries[0]?.components).toEqual({ backend: 'b1' });
  });

  test('파일 형식 — 빈 스택도 유효하다', () => {
    expect(RollbackStackSchema.safeParse(EMPTY_ROLLBACK_STACK).success).toBe(
      true,
    );
    expect(RollbackStackSchema.safeParse({ entries: [] }).success).toBe(false);
  });
});

describe('매니페스트 조립', () => {
  test('항목에 없고 live 에 있는 컴포넌트는 baseline 을 명시한다 — 빠짐은 그대로다', () => {
    const manifest = rollbackManifest(
      entry('1.0.0', { backend: 'b1' }),
      live({ backend: 'b2', frontend: 'f2' }),
    );
    expect(manifest.components).toEqual({
      backend: 'b1',
      frontend: BASELINE_GENERATION,
    });
  });

  test('같은 것은 담지 않는다', () => {
    const manifest = rollbackManifest(
      entry('1.0.0', { backend: 'b1', frontend: 'f1' }),
      live({ backend: 'b2', frontend: 'f1' }),
    );
    expect(manifest.components).toEqual({ backend: 'b1' });
  });

  test('전부 baseline 이던 조합으로 — 명시 없이 보내면 아무것도 안 돌아간다', () => {
    const manifest = rollbackManifest(
      entry('1.0.0', {}),
      live({ [SERIALPORT_PROCESS.TOKEN_DISPENSER]: 's2' }),
    );
    expect(manifest.components).toEqual({
      [SERIALPORT_PROCESS.TOKEN_DISPENSER]: BASELINE_GENERATION,
    });
    expect(manifest.base).toBeUndefined();
  });

  test('이미 그 조합이면 비어 있다', () => {
    expect(
      rollbackManifest(entry('1.0.0', {}), INITIAL_POINTER).components,
    ).toEqual({});
  });

  test('live 에 baseline 이 글자로 적혀 있어도 "없음"과 같다 — 앞선 롤백이 남긴 모양', () => {
    // 롤백 매니페스트가 baseline 을 명시하므로 포인터에 그 문자열이 남는다.
    expect(
      rollbackManifest(
        entry('1.0.0', {}),
        live({ backend: BASELINE_GENERATION }),
      ).components,
    ).toEqual({});
    expect(
      rollbackManifest(
        entry('1.0.0', { backend: BASELINE_GENERATION }),
        live({ backend: 'b2' }),
      ).components,
    ).toEqual({ backend: BASELINE_GENERATION });
  });

  test('항목의 base 는 매니페스트에 싣지 않는다 — 설치본 축은 판정자가 따로 가른다', () => {
    const manifest = rollbackManifest(
      entry('1.0.0', { backend: 'b1' }),
      live({}),
    );
    expect('base' in manifest).toBe(false);
  });
});

describe('정리 보호', () => {
  test('지금 셸의 항목이 붙드는 세대만 — 다른 설치본의 세대는 이 셸에 없다', () => {
    let stack = pushRollback(
      EMPTY_ROLLBACK_STACK,
      entry('1.0.0', { backend: 'old' }),
    );
    stack = pushRollback(stack, entry('2.0.0', { backend: 'b1' }));
    stack = pushRollback(stack, entry('2.0.0', {}));
    expect(generationsHeldBy(stack, '2.0.0', UPDATE_COMPONENT.BACKEND)).toEqual(
      ['b1', BASELINE_GENERATION],
    );
    expect(
      generationsHeldBy(stack, '2.0.0', UPDATE_COMPONENT.FRONTEND),
    ).toEqual([BASELINE_GENERATION, BASELINE_GENERATION]);
  });
});
