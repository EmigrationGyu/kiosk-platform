import { describe, expect, mock, test } from 'bun:test';
import { ABANDON_REASON } from '@/shared/analytics';
import { type IdleCommandDeps, makeIdleCommandRunner } from './idleCommands';

/**
 * 커맨드 러너 단위 테스트 — 커맨드 → 부수효과 매핑을 spy 로 박제.
 * 특히 fire 의 **순서 불변식**(경고 해제 → 오버레이 수거 → goHome)을 고정한다.
 */
const makeDeps = () => {
  const calls: string[] = [];
  const deps: IdleCommandDeps = {
    beginWarning: mock((d: number) => {
      calls.push(`beginWarning:${d}`);
    }),
    dismissWarning: mock(() => {
      calls.push('dismissWarning');
    }),
    dismissGlobalUI: mock(() => {
      calls.push('dismissGlobalUI');
    }),
    goHome: mock((r: string) => {
      calls.push(`goHome:${r}`);
    }),
    now: () => 1000,
    graceMs: 60,
  };
  return { deps, calls };
};

describe('makeIdleCommandRunner', () => {
  test('warn → beginWarning(now + graceMs)', () => {
    const { deps, calls } = makeDeps();
    makeIdleCommandRunner(deps)('warn');
    expect(calls).toEqual(['beginWarning:1060']);
  });

  test('counting → dismissWarning 만', () => {
    const { deps, calls } = makeDeps();
    makeIdleCommandRunner(deps)('counting');
    expect(calls).toEqual(['dismissWarning']);
  });

  test('fire → dismissWarning → dismissGlobalUI → goHome(IDLE) 순서', () => {
    const { deps, calls } = makeDeps();
    makeIdleCommandRunner(deps)('fire');
    expect(calls).toEqual([
      'dismissWarning',
      'dismissGlobalUI',
      `goHome:${ABANDON_REASON.IDLE}`,
    ]);
  });

  test('fire → 경고 해제가 goHome 보다 먼저 (overlay stuck 방지)', () => {
    const { deps, calls } = makeDeps();
    makeIdleCommandRunner(deps)('fire');
    expect(calls.indexOf('dismissWarning')).toBeLessThan(
      calls.indexOf(`goHome:${ABANDON_REASON.IDLE}`),
    );
  });
});
