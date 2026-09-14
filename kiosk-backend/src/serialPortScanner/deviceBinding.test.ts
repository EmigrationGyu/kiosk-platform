import { describe, expect, test } from 'bun:test';
import { DEVICE_IDS, type DeviceId } from 'src/constant/events/Hardware';
import {
  type DeviceBinding,
  decideNextStep,
  emptyHistory,
  type RecoveryHistory,
  type RecoveryStep,
  recordStep,
} from './deviceBinding';
import type { DetectionResult } from './types';

/**
 * 바인딩 복구 결정 코어 박제.
 * 하드웨어 영역이라 스텝 선택(비파괴 우선순위·반복 차단·종결성)을 촘촘히 고정한다.
 */

const lease = (portPath: string): DetectionResult => ({
  deviceId: DEVICE_IDS.TOKEN_DISPENSER,
  portPath,
  serialOptions: { path: portPath, baudRate: 9600, autoOpen: false },
});

const leased = (portPath: string): DeviceBinding => ({
  kind: 'leased',
  lease: lease(portPath),
});
const unleased = (scanInFlight: boolean): DeviceBinding => ({
  kind: 'unleased',
  scanInFlight,
});

const after = (...steps: RecoveryStep[]): RecoveryHistory =>
  steps.reduce(recordStep, emptyHistory());

describe('decideNextStep — 우선순위', () => {
  test('lease 가 있으면 스캔 진행 여부와 무관하게 rebind 가 최우선', () => {
    expect(decideNextStep(leased('COM3'), emptyHistory())).toEqual({
      kind: 'rebind',
      lease: lease('COM3'),
    });
  });

  test('lease 없음 + 스캔 진행 중 → 경쟁 재스캔 대신 진행 중 스캔에 편승', () => {
    expect(decideNextStep(unleased(true), emptyHistory())).toEqual({
      kind: 'await-scan',
    });
  });

  test('lease 없음 + 스캔 없음 → 파괴적 rescan 은 최후 수단으로만', () => {
    expect(decideNextStep(unleased(false), emptyHistory())).toEqual({
      kind: 'rescan',
    });
  });
});

describe('decideNextStep — 반복 차단', () => {
  test('실패한 포트로는 같은 런에서 rebind 를 재시도하지 않는다', () => {
    const history = after({ kind: 'rebind', lease: lease('COM3') });
    expect(decideNextStep(leased('COM3'), history)).toEqual({
      kind: 'rescan',
    });
  });

  test('경쟁 스캔이 다른 포트로 새 lease 를 만들면 그 포트로는 rebind 허용', () => {
    const history = after({ kind: 'rebind', lease: lease('COM3') });
    expect(decideNextStep(leased('COM7'), history)).toEqual({
      kind: 'rebind',
      lease: lease('COM7'),
    });
  });

  test('await-scan 은 런당 1회 — 스캔이 계속 돌아도 두 번 기다리지 않는다', () => {
    const history = after({ kind: 'await-scan' });
    expect(decideNextStep(unleased(true), history)).toEqual({
      kind: 'rescan',
    });
  });

  test('rescan 까지 소진하면 단념(null)', () => {
    const history = after({ kind: 'await-scan' }, { kind: 'rescan' });
    expect(decideNextStep(unleased(true), history)).toBeNull();
    expect(decideNextStep(unleased(false), history)).toBeNull();
  });
});

describe('decideNextStep — 종결성', () => {
  test('어떤 binding 시퀀스도 유한 스텝 내 종료 (스텝 수 ≤ 포트 수 + 2)', () => {
    // 병리적 시나리오: 결정할 때마다 스캐너 상태가 최악으로 바뀐다고 가정 —
    // 매 스텝 새 lease 공급(포트 풀 순환) 또는 스캔 재진입.
    const ports = ['COM1', 'COM2', 'COM3'];
    const adversarialBindings: DeviceBinding[] = [
      ...ports.map(leased),
      unleased(true),
      unleased(false),
    ];

    for (let start = 0; start < adversarialBindings.length; start++) {
      let history = emptyHistory();
      let steps = 0;
      for (let i = 0; ; i++) {
        const binding =
          adversarialBindings[(start + i) % adversarialBindings.length]!;
        const step = decideNextStep(binding, history);
        if (!step) break;
        history = recordStep(history, step);
        steps += 1;
        expect(steps).toBeLessThanOrEqual(ports.length + 2);
      }
    }
  });
});

describe('recordStep — 불변 갱신', () => {
  test('원본 history 를 변경하지 않는다', () => {
    const original = emptyHistory();
    recordStep(original, { kind: 'rebind', lease: lease('COM3') });
    recordStep(original, { kind: 'await-scan' });
    recordStep(original, { kind: 'rescan' });
    expect(original).toEqual(emptyHistory());
  });
});
