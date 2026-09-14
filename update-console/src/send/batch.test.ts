import { describe, expect, test } from 'bun:test';
import type { Deployment } from '../fleet';
import {
  recoverBatchId,
  summarizeBatch,
  toComponents,
  unfinishedKiosks,
} from './batch';

const row = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd1',
  batchId: 'b1',
  kioskId: 'k1',
  domain: 'backend',
  version: '0.30.0-9',
  previousVersion: null,
  status: 'COMPLETED',
  errorMessage: null,
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('toComponents', () => {
  test('컴포넌트 조합을 목록으로 편다', () => {
    expect(
      toComponents({ components: { backend: '0.30.0-9', ime: '0.29.0-9' } }),
    ).toEqual([
      { domain: 'backend', version: '0.30.0-9' },
      { domain: 'ime', version: '0.29.0-9' },
    ]);
  });

  test('앱 설치본은 base 도메인 한 줄이 된다', () => {
    expect(toComponents({ base: '1.28.0-alpha.9' })).toEqual([
      { domain: 'base', version: '1.28.0-alpha.9' },
    ]);
  });
});

describe('summarizeBatch', () => {
  test('기기 단위로 접는다', () => {
    const out = summarizeBatch([
      row(),
      row({ id: 'd2', domain: 'frontend' }),
      row({ id: 'd3', kioskId: 'k2' }),
    ]);
    expect(out).toEqual([
      { id: 'k1', status: 'ok' },
      { id: 'k2', status: 'ok' },
    ]);
  });

  test('하나라도 실패면 그 기기는 실패 ★', () => {
    const out = summarizeBatch([
      row(),
      row({
        id: 'd2',
        domain: 'ime',
        status: 'FAILED',
        errorMessage: '계약 불일치',
      }),
    ]);
    expect(out).toEqual([{ id: 'k1', status: 'failed', error: '계약 불일치' }]);
  });

  test('덮어쓴 지시는 성공이 아니다 — 이 발송은 끝까지 못 갔다 ★', () => {
    const out = summarizeBatch([row({ status: 'CANCELED' })]);
    expect(out[0]).toEqual({
      id: 'k1',
      status: 'failed',
      error: '더 새 지시가 덮었습니다',
    });
  });

  test('결론이 안 온 것이 섞여 있으면 아직 도는 중', () => {
    const out = summarizeBatch([row(), row({ id: 'd2', status: 'SENT' })]);
    expect(out[0]?.status).toBe('sending');
  });

  test('실패가 미결보다 세다 — 손댈 곳이 묻히면 안 된다', () => {
    const out = summarizeBatch([
      row({ status: 'SENT' }),
      row({ id: 'd2', status: 'FAILED' }),
    ]);
    expect(out[0]?.status).toBe('failed');
  });
});

describe('unfinishedKiosks', () => {
  test('실패뿐 아니라 결론이 안 온 것도 다시 보낸다 ★', () => {
    const ids = unfinishedKiosks([
      row({ kioskId: 'ok' }),
      row({ id: 'd2', kioskId: 'stuck', status: 'SENT' }),
      row({ id: 'd3', kioskId: 'bad', status: 'FAILED' }),
    ]);
    expect(ids.sort()).toEqual(['bad', 'stuck']);
  });

  test('전부 끝났으면 다시 보낼 것이 없다', () => {
    expect(unfinishedKiosks([row()])).toEqual([]);
  });
});

describe('recoverBatchId', () => {
  test('부분 실패 메시지에서 발송 id 를 건져낸다 ★', () => {
    const cause = new Error(
      '배포 batch 01M1X8GBJDHVMA9GXETVM2XMBR 가 200건까지 생성된 뒤 중단됐습니다. deployments(filter: { batchId }) 로 확인해 취소하세요.',
    );
    expect(recoverBatchId(cause)).toBe('01M1X8GBJDHVMA9GXETVM2XMBR');
  });

  test('없으면 null — 틀린 id 를 지어내지 않는다', () => {
    expect(recoverBatchId(new Error('UNAUTHORIZED'))).toBeNull();
    expect(recoverBatchId(new Error('batch 짧음'))).toBeNull();
  });
});
