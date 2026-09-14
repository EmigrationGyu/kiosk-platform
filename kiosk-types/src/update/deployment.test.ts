import { describe, expect, test } from 'bun:test';
import {
  BASE_DOMAIN,
  DeploymentCommandSchema,
  type DeploymentRow,
  groupByBatch,
  normalizeDeployment,
} from './deployment';

const row = (over: Partial<DeploymentRow> = {}): DeploymentRow => ({
  id: 'd1',
  domain: 'backend',
  version: '0.30.0-7',
  ...over,
});

describe('normalizeDeployment', () => {
  test('컴포넌트 행들을 매니페스트 하나로 접는다', () => {
    const out = normalizeDeployment([
      row(),
      row({ id: 'd2', domain: 'frontend', version: '0.30.0-7' }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.manifest.components).toEqual({
      backend: '0.30.0-7',
      frontend: '0.30.0-7',
    });
    expect(out.manifest.base).toBeUndefined();
  });

  test('설치본 단독이면 base 매니페스트가 된다', () => {
    const out = normalizeDeployment([
      row({ id: 'd9', domain: BASE_DOMAIN, version: '1.28.0-alpha.7' }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.manifest.base).toBe('1.28.0-alpha.7');
    expect(out.manifest.components).toEqual({});
  });

  test('설치본과 컴포넌트가 섞이면 거절한다 ★', () => {
    const out = normalizeDeployment([
      row(),
      row({ id: 'd9', domain: BASE_DOMAIN, version: '1.28.0-alpha.7' }),
    ]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain('함께 받을 수 없습니다');
  });

  test('거절도 행 좌표를 들고 나온다 — 보고해야 SENT 에 안 남는다 ★', () => {
    const out = normalizeDeployment([
      row(),
      row({ id: 'd9', domain: BASE_DOMAIN, version: '1.28.0-alpha.7' }),
    ]);
    expect(out.ids).toEqual({ backend: 'd1', base: 'd9' });
  });

  test('같은 도메인이 두 번이면 거절한다 — 덮어써서 조용히 사라지는 것을 막는다', () => {
    const out = normalizeDeployment([
      row(),
      row({ id: 'd2', version: '0.30.0-6' }),
    ]);
    expect(out.ok).toBe(false);
  });

  test('빈 지시는 거절', () => {
    expect(normalizeDeployment([]).ok).toBe(false);
  });

  test('성공해도 좌표를 들고 나온다 — 결과 보고가 행 단위다', () => {
    const out = normalizeDeployment([
      row(),
      row({ id: 'd2', domain: 'token-dispenser', version: '0.29.0-1' }),
    ]);
    expect(out.ids).toEqual({ backend: 'd1', 'token-dispenser': 'd2' });
  });
});

describe('groupByBatch', () => {
  test('발송 단위로 나눈다 — 다른 배치가 한 매니페스트로 섞이면 안 된다 ★', () => {
    const groups = groupByBatch([
      { ...row(), batchId: 'b1' },
      { ...row({ id: 'd2', domain: 'frontend' }), batchId: 'b2' },
      { ...row({ id: 'd3', domain: 'ime', version: '0.28.0' }), batchId: 'b1' },
    ]);
    expect(groups.map((g) => g.batchId)).toEqual(['b1', 'b2']);
    expect(groups[0]?.deployments).toHaveLength(2);
    expect(groups[1]?.deployments).toHaveLength(1);
  });

  test('들어온 순서를 지킨다 — 서버가 오래된 것부터 준다', () => {
    const groups = groupByBatch([
      { ...row(), batchId: 'old' },
      { ...row({ id: 'd2' }), batchId: 'new' },
    ]);
    expect(groups[0]?.batchId).toBe('old');
  });
});

describe('DeploymentCommandSchema', () => {
  test('알림 payload 를 그대로 받는다', () => {
    const parsed = DeploymentCommandSchema.safeParse({
      batchId: 'b1',
      deployments: [
        {
          id: 'd1',
          domain: 'backend',
          version: '0.30.0-7',
          previousVersion: '0.30.0-6',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test('previousVersion 은 null 로도 온다', () => {
    const parsed = DeploymentCommandSchema.safeParse({
      batchId: 'b1',
      deployments: [
        {
          id: 'd1',
          domain: 'backend',
          version: '0.30.0-7',
          previousVersion: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test('빈 배포 목록은 거절', () => {
    expect(
      DeploymentCommandSchema.safeParse({ batchId: 'b1', deployments: [] })
        .success,
    ).toBe(false);
  });
});
