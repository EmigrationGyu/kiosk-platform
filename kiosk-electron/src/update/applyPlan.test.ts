import { describe, expect, test } from 'bun:test';
import { planRestart } from './applyPlan';

describe('재기동 범위 유도', () => {
  test('백엔드만 바뀌면 백엔드만 — 하드웨어는 살아있다', () => {
    expect(planRestart(['backend'])).toEqual({
      backend: true,
      renderer: false,
      devices: [],
    });
  });

  test('프론트만 바뀌면 렌더러만 — 백엔드 재기동 없음', () => {
    expect(planRestart(['frontend'])).toEqual({
      backend: false,
      renderer: true,
      devices: [],
    });
  });

  test('장치만 바뀌면 그 장치만 — 백엔드·렌더러 무관', () => {
    expect(planRestart(['token-dispenser'])).toEqual({
      backend: false,
      renderer: false,
      devices: ['token-dispenser'],
    });
  });

  test('여럿이 바뀌면 모두 포함한다', () => {
    const plan = planRestart(['backend', 'frontend', 'ime', 'ime']);

    expect(plan.backend).toBe(true);
    expect(plan.renderer).toBe(true);
    expect(plan.devices).toEqual(['ime', 'ime']);
  });

  test('아무것도 안 바뀌면 아무것도 띄우지 않는다', () => {
    expect(planRestart([])).toEqual({
      backend: false,
      renderer: false,
      devices: [],
    });
  });
});
