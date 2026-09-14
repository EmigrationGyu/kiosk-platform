import { describe, expect, test } from 'bun:test';
import { APPLY_OUTCOME, type ApplyRecord } from './applyRecord';
import { INITIAL_POINTER, type Pointer } from './generation';
import {
  type ApplyResultReport,
  ApplyResultReportSchema,
  buildApplyResultReport,
  buildSoftwareStateReport,
  REPORT_STATUS,
  type SoftwareStateReport,
  SoftwareStateReportSchema,
  statusOf,
  toResultReports,
  toVersionReport,
} from './report';
import { EMPTY_ROLLBACK_STACK, pushRollback } from './rollbackStack';

const NOW = '2026-09-03T09:00:00Z';

const live = (components: Pointer['components']): Pointer => ({
  pointerVersion: 1,
  components,
});

const record = (overrides?: Partial<ApplyRecord>): ApplyRecord => ({
  recordVersion: 1,
  commandId: 'cmd-1',
  deploymentIds: {},
  at: '2026-09-03T08:59:00Z',
  requested: { backend: 'b2' },
  requestedBase: null,
  outcome: APPLY_OUTCOME.APPLIED,
  detail: 'backend',
  rolledBackTo: null,
  reported: false,
  ...overrides,
});

describe('상태 보고', () => {
  test('지금 조합·안정 조합·롤백 목적지·마지막 기록을 한 덩어리로', () => {
    const stack = pushRollback(EMPTY_ROLLBACK_STACK, {
      base: '1.0.0',
      components: { backend: 'b1' },
      commandId: 'cmd-1',
      at: NOW,
    });
    const report = buildSoftwareStateReport({
      appVersion: '1.0.0',
      live: live({ backend: 'b2' }),
      stable: live({ backend: 'b2' }),
      stack,
      lastApply: record(),
      now: NOW,
    });
    expect(report.rollbackTop?.components).toEqual({ backend: 'b1' });
    expect(report.live).toEqual({ backend: 'b2' });
    expect(report.lastApply?.commandId).toBe('cmd-1');
    expect(SoftwareStateReportSchema.safeParse(report).success).toBe(true);
  });

  test('스택이 비고 기록이 없어도 유효하다 — 첫 부팅', () => {
    const report = buildSoftwareStateReport({
      appVersion: '1.0.0',
      live: INITIAL_POINTER,
      stable: INITIAL_POINTER,
      stack: EMPTY_ROLLBACK_STACK,
      lastApply: null,
      now: NOW,
    });
    expect(report.rollbackTop).toBeNull();
    expect(SoftwareStateReportSchema.safeParse(report).success).toBe(true);
  });
});

describe('결과 보고', () => {
  test('미보고 기록만 — applied 는 기록이 아니라 지금 live 다', () => {
    const report = buildApplyResultReport({
      record: record({
        outcome: APPLY_OUTCOME.ROLLED_BACK,
        rolledBackTo: 'stable',
      }),
      live: live({ backend: 'b1' }),
      appVersion: '1.0.0',
      now: NOW,
    });
    expect(report?.status).toBe(REPORT_STATUS.FAILED);
    expect(report?.applied).toEqual({ backend: 'b1' });
    expect(ApplyResultReportSchema.safeParse(report).success).toBe(true);
  });

  test('이미 보고했거나 기록이 없으면 null', () => {
    expect(
      buildApplyResultReport({
        record: record({ reported: true }),
        live: INITIAL_POINTER,
        appVersion: '1.0.0',
        now: NOW,
      }),
    ).toBeNull();
    expect(
      buildApplyResultReport({
        record: null,
        live: INITIAL_POINTER,
        appVersion: '1.0.0',
        now: NOW,
      }),
    ).toBeNull();
  });

  test('outcome → status 매핑', () => {
    expect(statusOf(APPLY_OUTCOME.APPLIED)).toBe(REPORT_STATUS.COMPLETED);
    expect(statusOf(APPLY_OUTCOME.INSTALLING)).toBe(REPORT_STATUS.PENDING);
    // 거절도 실패 — 시킨 일이 일어나지 않았다. 사유는 cause 가 든다.
    for (const outcome of [
      APPLY_OUTCOME.DECLINED,
      APPLY_OUTCOME.ROLLED_BACK,
      APPLY_OUTCOME.MISMATCH,
      APPLY_OUTCOME.THREW,
    ]) {
      expect(statusOf(outcome)).toBe(REPORT_STATUS.FAILED);
    }
  });
});

describe('toVersionReport — EntityVersion 축으로', () => {
  const state = (
    over: Partial<SoftwareStateReport> = {},
  ): SoftwareStateReport => ({
    ...buildSoftwareStateReport({
      appVersion: '1.28.0-alpha.7',
      live: live({ backend: '0.30.0-7' }),
      stable: live({}),
      stack: EMPTY_ROLLBACK_STACK,
      lastApply: null,
      now: NOW,
    }),
    ...over,
  });

  test('앱 설치본은 base 도메인으로 실린다', () => {
    const report = toVersionReport(state());
    expect(report.components[0]).toEqual({
      domain: 'base',
      version: '1.28.0-alpha.7',
    });
    expect(report.reportedAt).toBe(NOW);
  });

  test('컴포넌트가 따라온다', () => {
    const report = toVersionReport(state());
    expect(report.components).toContainEqual({
      domain: 'backend',
      version: '0.30.0-7',
    });
  });

  test('baseline 은 보고하지 않는다 — 버전이 아니라 "동봉본" 표시다 ★', () => {
    const report = toVersionReport(
      state({ live: { backend: 'baseline', frontend: '0.30.0-7' } }),
    );
    const domains = report.components.map((c) => c.domain);
    expect(domains).not.toContain('backend');
    expect(domains).toContain('frontend');
  });

  test('갱신된 적 없으면 동봉본의 실제 버전이 나간다 ★', () => {
    const report = toVersionReport(
      state({
        live: {},
        baselineVersions: { backend: '0.29.0', frontend: '0.29.0' },
      }),
    );
    expect(report.components).toContainEqual({
      domain: 'backend',
      version: '0.29.0',
    });
  });

  test('세대가 있으면 세대가 이긴다 — 동봉본은 더 안 돈다', () => {
    const report = toVersionReport(
      state({
        live: { backend: '0.30.0-7' },
        baselineVersions: { backend: '0.29.0' },
      }),
    );
    expect(report.components.find((c) => c.domain === 'backend')?.version).toBe(
      '0.30.0-7',
    );
  });

  test('baseline 으로 되돌아갔으면 동봉본 버전으로 떨어진다', () => {
    const report = toVersionReport(
      state({
        live: { backend: 'baseline' },
        baselineVersions: { backend: '0.29.0' },
      }),
    );
    expect(report.components.find((c) => c.domain === 'backend')?.version).toBe(
      '0.29.0',
    );
  });

  test('둘 다 없으면 뺀다 — 못 읽은 것을 지어내지 않는다 ★', () => {
    const report = toVersionReport(state({ live: {}, baselineVersions: {} }));
    expect(report.components.map((c) => c.domain)).toEqual(['base']);
  });

  test('되돌림 스택 top 이 previousVersion 이 된다', () => {
    const report = toVersionReport(
      state({
        rollbackTop: {
          base: '1.28.0-alpha.6',
          components: { backend: '0.30.0-6' },
          commandId: 'cmd-0',
          at: NOW,
        },
      }),
    );
    expect(report.components).toContainEqual({
      domain: 'base',
      version: '1.28.0-alpha.7',
      previousVersion: '1.28.0-alpha.6',
    });
    expect(report.components).toContainEqual({
      domain: 'backend',
      version: '0.30.0-7',
      previousVersion: '0.30.0-6',
    });
  });

  test('스택이 비면 previousVersion 을 싣지 않는다 — 서버가 저장값으로 채운다', () => {
    const report = toVersionReport(state());
    for (const component of report.components) {
      expect(component.previousVersion).toBeUndefined();
    }
  });

  test('직전이 baseline 이면 previousVersion 도 생략한다', () => {
    const report = toVersionReport(
      state({
        rollbackTop: {
          base: '1.28.0-alpha.6',
          components: { backend: 'baseline' },
          commandId: null,
          at: NOW,
        },
      }),
    );
    expect(
      report.components.find((c) => c.domain === 'backend')?.previousVersion,
    ).toBeUndefined();
  });
});

describe('toResultReports — Deployment 축으로', () => {
  const result = (
    over: Partial<ApplyResultReport> = {},
  ): ApplyResultReport => ({
    reportVersion: 1,
    commandId: 'batch-1',
    status: REPORT_STATUS.COMPLETED,
    outcome: APPLY_OUTCOME.APPLIED,
    cause: '',
    applied: { backend: '0.30.0-7' },
    appVersion: '1.28.0-alpha.7',
    at: NOW,
    ...over,
  });

  test('같은 결론을 행 수만큼 펼친다 — 조합은 통째로 서거나 통째로 되감긴다 ★', () => {
    const out = toResultReports(result(), {
      backend: 'd1',
      frontend: 'd2',
    });
    expect(out).toEqual([
      { deploymentId: 'd1', status: 'COMPLETED' },
      { deploymentId: 'd2', status: 'COMPLETED' },
    ]);
  });

  test('실패면 사유가 errorMessage 로 간다', () => {
    const out = toResultReports(
      result({
        status: REPORT_STATUS.FAILED,
        outcome: APPLY_OUTCOME.MISMATCH,
        cause: '계약 지문 불일치',
      }),
      { backend: 'd1' },
    );
    expect(out[0]).toEqual({
      deploymentId: 'd1',
      status: 'FAILED',
      errorMessage: '계약 지문 불일치',
    });
  });

  test('installing 은 아무것도 안 보낸다 — 아직 결말이 아니다 ★', () => {
    const out = toResultReports(
      result({
        status: REPORT_STATUS.PENDING,
        outcome: APPLY_OUTCOME.INSTALLING,
      }),
      { base: 'd1' },
    );
    expect(out).toEqual([]);
  });

  test('좌표가 없으면 보낼 것도 없다 — 하네스·워치독 경로', () => {
    expect(toResultReports(result(), {})).toEqual([]);
  });
});

describe('이미 그 버전일 때', () => {
  test('unchanged 는 완료다 — 원한 상태가 이미 참이다 ★', () => {
    expect(statusOf(APPLY_OUTCOME.UNCHANGED)).toBe(REPORT_STATUS.COMPLETED);
  });

  test('declined 는 여전히 실패 — 세대가 없거나 되돌릴 스택이 비었다', () => {
    expect(statusOf(APPLY_OUTCOME.DECLINED)).toBe(REPORT_STATUS.FAILED);
  });

  test('완료로 보고되므로 서버의 COMPLETED 와 충돌하지 않는다', () => {
    const out = toResultReports(
      {
        reportVersion: 1,
        commandId: 'b1',
        status: statusOf(APPLY_OUTCOME.UNCHANGED),
        outcome: APPLY_OUTCOME.UNCHANGED,
        cause: '바뀐 컴포넌트 없음',
        applied: { ime: '0.29.0-9' },
        appVersion: '1.28.0-alpha.9',
        at: NOW,
      },
      { ime: 'd1' },
    );
    expect(out).toEqual([{ deploymentId: 'd1', status: 'COMPLETED' }]);
  });
});
