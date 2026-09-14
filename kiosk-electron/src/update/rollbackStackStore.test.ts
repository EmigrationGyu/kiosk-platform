import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EMPTY_ROLLBACK_STACK,
  ROLLBACK_STACK_FILE,
  type RollbackStack,
} from 'kiosk-types/src/update/rollbackStack';
import { createRollbackStackStore } from './rollbackStackStore';

let root: string;

const stack: RollbackStack = {
  stackVersion: 1,
  entries: [
    {
      base: '1.26.0',
      components: { backend: 'b1' },
      commandId: 'cmd',
      at: '2026-09-03T00:00:00Z',
    },
  ],
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rollback-stack-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('되돌림 스택 저장소', () => {
  test('없으면 빈 스택 — 첫 부팅을 막지 않는다', () => {
    const dir = path.join(root, 'update');
    expect(createRollbackStackStore({ dir }).read()).toEqual(
      EMPTY_ROLLBACK_STACK,
    );
    expect(existsSync(dir)).toBe(true);
  });

  test('쓴 것을 그대로 읽는다', () => {
    const store = createRollbackStackStore({ dir: root });
    store.write(stack);
    expect(store.read()).toEqual(stack);
    expect(readdirSync(root)).toEqual([ROLLBACK_STACK_FILE]); // staging 이 남지 않는다
  });

  test('깨진 파일은 빈 스택으로 읽고 알린다', () => {
    const logs: string[] = [];
    writeFileSync(path.join(root, ROLLBACK_STACK_FILE), '{ "stackVersion": 1');
    const store = createRollbackStackStore({
      dir: root,
      onLog: (m) => logs.push(m),
    });
    expect(store.read()).toEqual(EMPTY_ROLLBACK_STACK);
    expect(logs).toHaveLength(1);
  });
});
