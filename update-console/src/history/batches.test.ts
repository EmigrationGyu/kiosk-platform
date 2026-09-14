import { describe, expect, test } from 'bun:test';
import type { Deployment } from '../fleet';
import { cancellable, groupBatches, needsAttention } from './batches';

const row = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd1',
  batchId: 'b1',
  kioskId: 'k1',
  domain: 'backend',
  version: '0.30.0-9',
  previousVersion: null,
  status: 'COMPLETED',
  errorMessage: null,
  createdBy: '민규',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

describe('groupBatches', () => {
  test('발송 단위로 접는다 — 사람이 기억하는 단위다', () => {
    const out = groupBatches([
      row(),
      row({ id: 'd2', domain: 'frontend' }),
      row({ id: 'd3', batchId: 'b2', createdAt: 2000 }),
    ]);
    expect(out.map((b) => b.batchId)).toEqual(['b2', 'b1']);
  });

  test('최근 것이 위로 온다', () => {
    const out = groupBatches([
      row({ batchId: 'old', createdAt: 1 }),
      row({ id: 'd2', batchId: 'new', createdAt: 9 }),
    ]);
    expect(out[0]?.batchId).toBe('new');
  });

  test('대상 수는 기기 수지 행 수가 아니다 ★', () => {
    const out = groupBatches([
      row({ kioskId: 'k1', domain: 'backend' }),
      row({ id: 'd2', kioskId: 'k1', domain: 'frontend' }),
      row({ id: 'd3', kioskId: 'k2', domain: 'backend' }),
    ]);
    expect(out[0]?.kiosks).toBe(2);
    expect(out[0]?.rows).toHaveLength(3);
  });

  test('같은 조합이 전 기기에 가므로 컴포넌트는 중복을 접는다', () => {
    const out = groupBatches([
      row({ kioskId: 'k1' }),
      row({ id: 'd2', kioskId: 'k2' }),
      row({ id: 'd3', kioskId: 'k1', domain: 'ime', version: '0.29.0-9' }),
    ]);
    expect(out[0]?.components).toEqual([
      { domain: 'backend', version: '0.30.0-9' },
      { domain: 'ime', version: '0.29.0-9' },
    ]);
  });

  test('상태를 센다', () => {
    const out = groupBatches([
      row(),
      row({ id: 'd2', status: 'FAILED' }),
      row({ id: 'd3', status: 'SENT' }),
      row({ id: 'd4', status: 'CANCELED' }),
    ]);
    expect(out[0]).toMatchObject({
      completed: 1,
      failed: 1,
      open: 1,
      canceled: 1,
    });
  });

  test('시작 시각은 가장 이른 행 — 나중 행이 시각을 뒤로 밀지 않는다', () => {
    const out = groupBatches([
      row({ createdAt: 500 }),
      row({ id: 'd2', createdAt: 100 }),
    ]);
    expect(out[0]?.at).toBe(100);
  });

  test('누른 사람은 아무 행에서나 읽어도 같다', () => {
    expect(groupBatches([row()])[0]?.by).toBe('민규');
    expect(groupBatches([row({ createdBy: null })])[0]?.by).toBeNull();
  });
});

describe('needsAttention', () => {
  test('실패나 미결이 있으면 손대야 한다', () => {
    const [failed] = groupBatches([row({ status: 'FAILED' })]);
    const [open] = groupBatches([row({ status: 'SENT' })]);
    const [done] = groupBatches([row()]);
    expect(failed && needsAttention(failed)).toBe(true);
    expect(open && needsAttention(open)).toBe(true);
    expect(done && needsAttention(done)).toBe(false);
  });

  test('취소된 것만 남았으면 손댈 것이 없다 — 이미 닫힌 발송이다', () => {
    const [canceled] = groupBatches([row({ status: 'CANCELED' })]);
    expect(canceled && needsAttention(canceled)).toBe(false);
  });
});

describe('cancellable', () => {
  test('SENT 만 취소할 수 있다 — 서버가 그것만 받는다 ★', () => {
    const [batch] = groupBatches([
      row({ status: 'SENT' }),
      row({ id: 'd2', status: 'COMPLETED' }),
      row({ id: 'd3', status: 'FAILED' }),
    ]);
    expect(batch && cancellable(batch).map((r) => r.id)).toEqual(['d1']);
  });
});
