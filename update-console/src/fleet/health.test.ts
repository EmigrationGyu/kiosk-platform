import { describe, expect, test } from 'bun:test';
import {
  describeState,
  HEALTHY,
  healthOf,
  isTroubled,
  matchesTargetFilter,
  SILENT_MS,
  STALE_SENT_MS,
  TARGET_FILTER,
} from './health';
import type { Deployment, EntityVersion } from './types';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
/** 서버 `Date` 스칼라는 epoch ms 로 온다 — 문자열이 아니다. */
const ago = (ms: number) => NOW - ms;

const version = (over: Partial<EntityVersion> = {}): EntityVersion => ({
  domain: 'backend',
  version: '0.30.0-7',
  previousVersion: null,
  reportedAt: ago(1000),
  removedAt: null,
  ...over,
});

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd1',
  batchId: 'b1',
  kioskId: 'k1',
  domain: 'backend',
  version: '0.30.0-7',
  previousVersion: null,
  status: 'SENT',
  errorMessage: null,
  createdBy: null,
  createdAt: ago(1000),
  updatedAt: ago(1000),
  ...over,
});

describe('healthOf', () => {
  test('방금 보고했고 열린 지시가 없으면 건강하다', () => {
    expect(healthOf([version()], [], NOW)).toEqual(HEALTHY);
  });

  test('보고가 하나도 없으면 침묵 — 한 번도 말한 적 없다는 뜻이다 ★', () => {
    expect(healthOf([], [], NOW).silent).toBe(true);
  });

  test('보고가 창을 넘기면 침묵', () => {
    expect(
      healthOf([version({ reportedAt: ago(SILENT_MS + 1) })], [], NOW).silent,
    ).toBe(true);
    expect(
      healthOf([version({ reportedAt: ago(SILENT_MS - 1) })], [], NOW).silent,
    ).toBe(false);
  });

  test('도메인마다 따로 오므로 제일 새 보고가 생존 신호다', () => {
    const health = healthOf(
      [
        version({ domain: 'backend', reportedAt: ago(SILENT_MS + 1) }),
        version({ domain: 'frontend', reportedAt: ago(1000) }),
      ],
      [],
      NOW,
    );
    expect(health.silent).toBe(false);
  });

  test('FAILED 지시를 센다', () => {
    const health = healthOf(
      [version()],
      [deployment({ status: 'FAILED' }), deployment({ id: 'd2' })],
      NOW,
    );
    expect(health.failed).toBe(1);
  });

  test('갓 보낸 SENT 는 지연이지 미적용이 아니다', () => {
    const health = healthOf(
      [version()],
      [deployment({ updatedAt: ago(STALE_SENT_MS - 1) })],
      NOW,
    );
    expect(health.pending).toBe(0);
  });

  test('창을 넘긴 SENT 는 미적용으로 센다', () => {
    const health = healthOf(
      [version()],
      [deployment({ updatedAt: ago(STALE_SENT_MS + 1) })],
      NOW,
    );
    expect(health.pending).toBe(1);
  });
});

describe('isTroubled', () => {
  test('실패나 미적용이 있으면 손대야 한다', () => {
    expect(isTroubled({ failed: 1, pending: 0, silent: false })).toBe(true);
    expect(isTroubled({ failed: 0, pending: 1, silent: false })).toBe(true);
  });

  test('침묵만으로는 이상이 아니다 — 별도 칩이 진다', () => {
    expect(isTroubled({ failed: 0, pending: 0, silent: true })).toBe(false);
  });
});

describe('matchesTargetFilter', () => {
  const trouble = { failed: 1, pending: 0, silent: false };
  const silent = { failed: 0, pending: 0, silent: true };

  test('전체는 다 통과', () => {
    expect(matchesTargetFilter(TARGET_FILTER.ALL, 'disconnected', silent)).toBe(
      true,
    );
  });

  test('연결·끊김은 연결 상태만 본다', () => {
    expect(
      matchesTargetFilter(TARGET_FILTER.CONNECTED, 'connected', silent),
    ).toBe(true);
    expect(
      matchesTargetFilter(TARGET_FILTER.OFFLINE, 'connected', trouble),
    ).toBe(false);
  });

  test('이상·미보고는 판정 결과만 본다', () => {
    expect(
      matchesTargetFilter(TARGET_FILTER.TROUBLE, 'connected', trouble),
    ).toBe(true);
    expect(
      matchesTargetFilter(TARGET_FILTER.TROUBLE, 'connected', silent),
    ).toBe(false);
    expect(matchesTargetFilter(TARGET_FILTER.SILENT, 'connected', silent)).toBe(
      true,
    );
  });
});

describe('describeState', () => {
  test('아무것도 없으면 그 사실만 말한다', () => {
    expect(describeState([], [])).toBe('보고 없음');
  });

  test('도는 버전을 줄로 편다', () => {
    expect(describeState([version()], [])).toContain('backend 0.30.0-7');
  });

  test('removedAt 은 빼고 그린다 — 더는 안 도는 세대다', () => {
    const out = describeState(
      [version({ domain: 'ime', removedAt: ago(1000) })],
      [],
    );
    expect(out).not.toContain('ime');
    expect(out).toContain('보고된 버전 없음');
  });

  test('손댈 것이 있으면 툴팁만 보고도 판단이 서야 한다 ★', () => {
    const out = describeState(
      [version()],
      [
        deployment({
          status: 'FAILED',
          domain: 'frontend',
          version: '0.30.0-8',
          errorMessage: '계약 지문 불일치',
        }),
      ],
    );
    expect(out).toContain('✕ frontend → 0.30.0-8');
    expect(out).toContain('계약 지문 불일치');
  });
});
