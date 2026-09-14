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
  APPLY_OUTCOME,
  APPLY_RECORD_FILE,
  type ApplyRecord,
} from 'kiosk-types/src/update/applyRecord';
import { createApplyRecordStore } from './applyRecordStore';

let root: string;

const record = (overrides?: Partial<ApplyRecord>): ApplyRecord => ({
  recordVersion: 1,
  commandId: '01KX094JBVKGTADB5JPRXH3D7J',
  deploymentIds: {},
  at: '2026-08-25T08:43:04.286Z',
  requested: { frontend: 'f5', 'token-dispenser': 'd2' },
  requestedBase: null,
  outcome: APPLY_OUTCOME.ROLLED_BACK,
  detail: '새 조합이 준비 선언을 하지 않았습니다',
  rolledBackTo: 'stable',
  reported: false,
  ...overrides,
});

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'apply-record-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('적용 결과 기록', () => {
  test('쓴 것을 그대로 되읽는다 — 실패한 컴포넌트와 버전이 남아야 한다', () => {
    const store = createApplyRecordStore({ dir: root });
    const entry = record();

    store.write(entry);

    expect(store.read()).toEqual(entry);
  });

  test('기록이 없으면 null — 첫 부팅이 정상이다', () => {
    expect(createApplyRecordStore({ dir: root }).read()).toBeNull();
  });

  test('손상된 기록은 null 로 읽고 부팅을 막지 않는다', () => {
    const logs: string[] = [];
    const store = createApplyRecordStore({
      dir: root,
      onLog: (m) => logs.push(m),
    });
    writeFileSync(path.join(root, APPLY_RECORD_FILE), '{ 반쯤 쓰다 말았다');

    expect(store.read()).toBeNull();
    expect(logs).toHaveLength(1);
  });

  test('중간 상태를 남기지 않는다 — 실패한 순간이 곧 전원이 나가는 순간이다', () => {
    const store = createApplyRecordStore({ dir: root });

    store.write(record());
    store.write(record({ outcome: APPLY_OUTCOME.APPLIED }));

    // staging 파일이 남으면 다음 쓰기가 그것을 이어쓴다.
    expect(readdirSync(root)).toEqual([APPLY_RECORD_FILE]);
    expect(existsSync(path.join(root, `${APPLY_RECORD_FILE}.staging`))).toBe(
      false,
    );
  });

  test('덮어쓴다 — 마지막 적용 하나만 들고 있다', () => {
    const store = createApplyRecordStore({ dir: root });

    store.write(record());
    store.write(record({ outcome: APPLY_OUTCOME.APPLIED, rolledBackTo: null }));

    expect(store.read()?.outcome).toBe(APPLY_OUTCOME.APPLIED);
    expect(store.read()?.rolledBackTo).toBeNull();
  });
});

describe('보고됨 표시', () => {
  test('같은 기록이면 세운다', () => {
    const store = createApplyRecordStore({ dir: root });
    store.write(record());
    expect(store.markReported('2026-08-25T08:43:04.286Z')).toBe(true);
    expect(store.read()?.reported).toBe(true);
  });

  test('그 사이 새 기록이 쓰였으면 세우지 않는다 — 옛 보고가 새 기록을 덮으면 안 된다', () => {
    const store = createApplyRecordStore({ dir: root });
    store.write(record({ at: '2026-08-25T09:00:00.000Z' }));
    expect(store.markReported('2026-08-25T08:43:04.286Z')).toBe(false);
    expect(store.read()?.reported).toBe(false);
  });

  test('이미 세워져 있거나 기록이 없으면 아무 일도 없다', () => {
    const store = createApplyRecordStore({ dir: root });
    expect(store.markReported('x')).toBe(false);
    store.write(record({ reported: true }));
    expect(store.markReported('2026-08-25T08:43:04.286Z')).toBe(false);
  });
});
