import { beforeEach, describe, expect, test } from 'bun:test';
import { IDLE_DEFAULT_TIMEOUT_MS } from '@/shared/constants/idle';
import { idleDisableKey, useIdleStore } from './idleStore';

/**
 * idleStore 전이 단위 테스트. 순수 상태 전이(DOM 불필요)라 getState 로 직접 검증한다.
 * 검증 대상: disable 키 **겹침 안전**, warningDeadline 라이프사이클, resetIdle **완전 복원**.
 */
const s = () => useIdleStore.getState();

beforeEach(() => {
  s().resetIdle();
});

describe('idleStore', () => {
  test('초기 상태', () => {
    expect(s().isIdleDisabled).toBe(false);
    expect(s().warningDeadline).toBeNull();
    expect(s().timeoutMs).toBe(IDLE_DEFAULT_TIMEOUT_MS);
  });

  test('disable 키 겹침 안전: 둘 잡고 하나 풀면 여전히 disabled, 둘 다 풀면 enabled', () => {
    const a = idleDisableKey('a');
    const b = idleDisableKey('b');
    s().addIdleDisableKey(a);
    s().addIdleDisableKey(b);
    expect(s().isIdleDisabled).toBe(true);
    s().removeIdleDisableKey(a);
    expect(s().isIdleDisabled).toBe(true); // b 가 아직 잡고 있음
    s().removeIdleDisableKey(b);
    expect(s().isIdleDisabled).toBe(false);
  });

  test('같은 키 중복 add 는 멱등 — 한 번 remove 로 해제', () => {
    const a = idleDisableKey('a');
    s().addIdleDisableKey(a);
    s().addIdleDisableKey(a);
    s().removeIdleDisableKey(a);
    expect(s().isIdleDisabled).toBe(false);
  });

  test('warningDeadline 라이프사이클: beginWarning → number, dismissWarning → null', () => {
    s().beginWarning(12345);
    expect(s().warningDeadline).toBe(12345);
    s().dismissWarning();
    expect(s().warningDeadline).toBeNull();
  });

  test('setIdleTimeoutMs 오버라이드', () => {
    s().setIdleTimeoutMs(5000);
    expect(s().timeoutMs).toBe(5000);
  });

  test('resetIdle: 키·기한·경고 전부 기본값으로 복원', () => {
    s().addIdleDisableKey(idleDisableKey('x'));
    s().setIdleTimeoutMs(1000);
    s().beginWarning(999);

    s().resetIdle();

    expect(s().isIdleDisabled).toBe(false);
    expect(s().timeoutMs).toBe(IDLE_DEFAULT_TIMEOUT_MS);
    expect(s().warningDeadline).toBeNull();
  });

  test('dismissWarning 는 멱등 — null 상태에서 다시 불러도 null', () => {
    s().dismissWarning();
    expect(s().warningDeadline).toBeNull();
    s().dismissWarning();
    expect(s().warningDeadline).toBeNull();
  });

  test('beginWarning 는 이전 deadline 을 덮어씀', () => {
    s().beginWarning(100);
    s().beginWarning(200);
    expect(s().warningDeadline).toBe(200);
  });

  test('없는 키 remove 는 안전(no-op)', () => {
    const a = idleDisableKey('a');
    s().addIdleDisableKey(a);
    s().removeIdleDisableKey(idleDisableKey('never-added'));
    expect(s().isIdleDisabled).toBe(true); // a 는 그대로
    s().removeIdleDisableKey(a);
    expect(s().isIdleDisabled).toBe(false);
  });
});
