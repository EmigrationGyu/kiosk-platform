import { describe, expect, test } from 'bun:test';
import {
  APPLY_OUTCOME,
  type ApplyRecord,
} from 'kiosk-types/src/update/applyRecord';
import { reconcileInstall } from './reconcileInstall';

const record = (overrides?: Partial<ApplyRecord>): ApplyRecord => ({
  recordVersion: 1,
  commandId: '01M10SFB20VRC8A3H4AVP22WFY',
  deploymentIds: {},
  at: '2026-08-27T05:01:10.510Z',
  requested: {},
  requestedBase: '1.23.0-alpha.4',
  outcome: APPLY_OUTCOME.INSTALLING,
  detail: 'C:\\Users\\me\\Kiosk\\update\\1.23.0-alpha.4\\Setup.exe',
  rolledBackTo: null,
  reported: false,
  ...overrides,
});

describe('설치 기록 정산', () => {
  test('요청한 버전으로 떴으면 설치된 것이다 ★', () => {
    const settled = reconcileInstall(record(), '1.23.0-alpha.4');

    expect(settled?.outcome).toBe(APPLY_OUTCOME.APPLIED);
    expect(settled?.commandId).toBe('01M10SFB20VRC8A3H4AVP22WFY');
  });

  test('옛 버전으로 떴으면 손대지 않는다 — 머물러 있는 것이 곧 실패다 ★', () => {
    expect(reconcileInstall(record(), '1.23.0-alpha.3')).toBeNull();
  });

  test('설치를 넘긴 기록이 아니면 건드리지 않는다', () => {
    expect(
      reconcileInstall(
        record({ outcome: APPLY_OUTCOME.ROLLED_BACK }),
        '1.23.0-alpha.4',
      ),
    ).toBeNull();
  });

  test('두 번째 부팅에는 쓸 것이 없다 — 매번 같은 파일을 다시 쓰지 않는다', () => {
    const settled = reconcileInstall(record(), '1.23.0-alpha.4');

    expect(reconcileInstall(settled, '1.23.0-alpha.4')).toBeNull();
  });

  test('기록이 없으면 아무 일도 없다', () => {
    expect(reconcileInstall(null, '1.23.0-alpha.4')).toBeNull();
  });
});
