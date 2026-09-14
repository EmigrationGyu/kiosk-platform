import { describe, expect, test } from 'bun:test';
import { createCrashEscalator } from './crashEscalator';

const FAST = 30_000;

function setup() {
  return createCrashEscalator({ fastDeathMs: FAST, threshold: 3 });
}

describe('빠른 종료의 연속을 센다', () => {
  test('연속 3회 빠른 종료 → 사다리를 내려간다 ★', () => {
    const e = setup();

    e.started(0);
    expect(e.exited(1_000)).toBe('restart');
    e.started(2_000);
    expect(e.exited(3_000)).toBe('restart');
    e.started(4_000);
    expect(e.exited(5_000)).toBe('escalate');
  });

  test('충분히 산 뒤의 죽음은 런타임 사고다 — 연속이 끊긴다', () => {
    const e = setup();

    e.started(0);
    expect(e.exited(1_000)).toBe('restart');
    e.started(2_000);
    // 오래 살았다 — 세대는 멀쩡했다.
    expect(e.exited(2_000 + FAST)).toBe('restart');
    e.started(100_000);
    expect(e.exited(101_000)).toBe('restart');
    e.started(102_000);
    expect(e.exited(103_000)).toBe('escalate');
  });

  test('선언 후 크래시 루프도 잡는다 — 준비 선언은 리셋 근거가 아니다 ★', () => {
    // 워치독은 매 사이클 해제되지만 여기는 수명만 본다. 선언 여부를 입력받지 않는
    // 것 자체가 설계다 — 크래시 루프도 매 사이클 선언하므로 근거가 못 된다.
    const e = setup();
    for (let cycle = 0; cycle < 2; cycle += 1) {
      e.started(cycle * 3_000);
      expect(e.exited(cycle * 3_000 + 2_000)).toBe('restart');
    }
    e.started(6_000);
    expect(e.exited(8_000)).toBe('escalate');
  });

  test('기동 시각을 모르는 죽음은 빠른 종료로 센다', () => {
    // 스폰 이벤트 전에 죽으면 started 가 안 불린다 — 그건 가장 빠른 종료다.
    const e = setup();
    expect(e.exited(1_000)).toBe('restart');
    expect(e.exited(2_000)).toBe('restart');
    expect(e.exited(3_000)).toBe('escalate');
  });

  test('내려간 뒤에는 새로 센다 — 다음 세대도 같은 기준으로 본다', () => {
    const e = setup();
    e.started(0);
    e.exited(1_000);
    e.started(2_000);
    e.exited(3_000);
    e.started(4_000);
    expect(e.exited(5_000)).toBe('escalate');

    // 내려간 세대(stable)가 또 즉사해도 3연속을 다시 채워야 내려간다.
    e.started(6_000);
    expect(e.exited(7_000)).toBe('restart');
    e.started(8_000);
    expect(e.exited(9_000)).toBe('restart');
    e.started(10_000);
    expect(e.exited(11_000)).toBe('escalate');
  });
});
