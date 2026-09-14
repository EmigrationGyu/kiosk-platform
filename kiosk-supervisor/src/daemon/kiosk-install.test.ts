import { describe, expect, test } from 'bun:test';
import { KIOSK_INSTALL_HOLD_MS } from '../constants';
import { applyRecordPath, readInstallingVersion } from './kiosk-install';

const NOW = Date.parse('2026-08-28T17:58:00.000Z');

/** 키오스크가 실제로 남기는 모양 (kiosk-types ApplyRecordSchema). */
function record(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    recordVersion: 1,
    commandId: '01M13SE58XYQXV7F2Z0F0JJ1TK',
    at: new Date(NOW - 5_000).toISOString(),
    requested: {},
    requestedBase: '1.26.0',
    outcome: 'installing',
    detail: 'C:\\Users\\Kiosk\\Kiosk\\update\\1.26.0\\Setup.exe',
    rolledBackTo: null,
    reported: false,
    ...over,
  });
}

describe('설치 중 판정', () => {
  test('installing + 유예 안이면 그 base 버전을 돌려준다 ★', () => {
    expect(readInstallingVersion(record(), NOW)).toBe('1.26.0');
  });

  test('다른 outcome 은 설치 중이 아니다 ★', () => {
    expect(
      readInstallingVersion(record({ outcome: 'applied' }), NOW),
    ).toBeNull();
  });

  test('유예가 지나면 놓아준다 — 설치가 끝나지 못한 것이다 ★', () => {
    const stale = record({
      at: new Date(NOW - KIOSK_INSTALL_HOLD_MS - 1).toISOString(),
    });

    expect(readInstallingVersion(stale, NOW)).toBeNull();
  });

  test('유예 경계 직전은 아직 설치 중이다', () => {
    const edge = record({
      at: new Date(NOW - KIOSK_INSTALL_HOLD_MS + 1_000).toISOString(),
    });

    expect(readInstallingVersion(edge, NOW)).toBe('1.26.0');
  });

  test('앞선 시각도 설치 중으로 본다 — 시계 어긋남을 "아니다"로 번역하지 않는다 ★', () => {
    const future = record({ at: new Date(NOW + 60_000).toISOString() });

    expect(readInstallingVersion(future, NOW)).toBe('1.26.0');
  });

  test('기록이 없으면 설치 중이 아니다', () => {
    expect(readInstallingVersion(null, NOW)).toBeNull();
  });

  test('반쯤 쓰인 기록은 선언으로 읽지 않는다 ★', () => {
    expect(readInstallingVersion('{"outcome":"instal', NOW)).toBeNull();
  });

  test('at 이 시각이 아니면 믿지 않는다', () => {
    expect(readInstallingVersion(record({ at: 'nope' }), NOW)).toBeNull();
  });

  test('모르는 필드가 늘어도 읽는다 — 기록의 주인은 키오스크다 ★', () => {
    const grown = record({ somethingNew: { deep: true } });

    expect(readInstallingVersion(grown, NOW)).toBe('1.26.0');
  });

  test('base 를 모르는 설치도 붙잡는다 — 버전은 로그용일 뿐이다', () => {
    expect(readInstallingVersion(record({ requestedBase: null }), NOW)).toBe(
      'unknown',
    );
  });
});

describe('기록 경로', () => {
  test('키오스크가 쓰는 자리와 같아야 한다 ★', () => {
    expect(applyRecordPath('Kiosk')).toBe(
      'C:\\Users\\Kiosk\\Kiosk\\update\\last-apply.json',
    );
  });
});
