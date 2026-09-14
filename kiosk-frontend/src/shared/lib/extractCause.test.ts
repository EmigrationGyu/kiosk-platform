import { describe, expect, test } from 'bun:test';
import { DEVICE_CHANNEL_CAUSE } from 'kiosk-types';
import { extractCause } from './extractCause';

describe('extractCause', () => {
  test('트랜스포트는 { cause, code } 로 던진다', () => {
    expect(extractCause({ cause: 'ABORTED', code: 500 })).toBe('ABORTED');
  });

  test('일반 Error 는 message', () => {
    expect(extractCause(new Error('Operation timed out after 10000ms'))).toBe(
      'Operation timed out after 10000ms',
    );
  });

  test('name 을 사유로 고정한 에러는 name 을 쓴다 (MutexPurgedError)', () => {
    const error = new Error('무언가');
    error.name = DEVICE_CHANNEL_CAUSE.OPERATION_PURGED;
    expect(extractCause(error)).toBe(DEVICE_CHANNEL_CAUSE.OPERATION_PURGED);
  });

  test('정체불명은 빈 문자열', () => {
    expect(extractCause(undefined)).toBe('');
    expect(extractCause(42)).toBe('');
  });
});
