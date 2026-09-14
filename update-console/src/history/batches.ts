import type { Deployment } from '../fleet';

/**
 * 이력을 **발송 단위**로 접는다.
 *
 * 서버는 행(키오스크 × 도메인)으로 준다. 사람이 기억하는 단위는 "그때 그 배포"라서,
 * 행을 그대로 늘어놓으면 100대 배포 하나가 화면을 다 먹고 그 앞뒤가 안 보인다.
 *
 * 접는 키는 `batchId` 다 — 한 호출로 만들어진 것들이고 서버가 그렇게 묶어 준다.
 */

export type BatchSummary = {
  batchId: string;
  /** 이 발송이 시작된 때(가장 이른 행). epoch ms. */
  at: number;
  /** 누가 눌렀나. 없으면 시스템. */
  by: string | null;
  /** 대상 기기 수 — 행 수가 아니다(한 기기에 도메인이 여럿이다). */
  kiosks: number;
  /** 무엇을 보냈나. 같은 조합이 전 기기에 가므로 중복을 접는다. */
  components: readonly { domain: string; version: string }[];
  completed: number;
  failed: number;
  /** 아직 결론이 없는 행 — 여기에만 취소가 뜻이 있다. */
  open: number;
  canceled: number;
  rows: readonly Deployment[];
};

const countBy = (rows: readonly Deployment[], status: string): number =>
  rows.filter((row) => row.status === status).length;

export function groupBatches(
  rows: readonly Deployment[],
): readonly BatchSummary[] {
  const byBatch = new Map<string, Deployment[]>();
  for (const row of rows) {
    const found = byBatch.get(row.batchId);
    if (found) found.push(row);
    else byBatch.set(row.batchId, [row]);
  }

  return [...byBatch.entries()]
    .map(([batchId, batch]): BatchSummary => {
      const components = new Map<string, { domain: string; version: string }>();
      for (const row of batch) {
        components.set(`${row.domain}@${row.version}`, {
          domain: row.domain,
          version: row.version,
        });
      }
      return {
        batchId,
        at: Math.min(...batch.map((row) => row.createdAt)),
        // 한 발송은 한 사람이 눌렀다 — 아무 행에서나 읽어도 같다.
        by: batch.find((row) => row.createdBy)?.createdBy ?? null,
        kiosks: new Set(batch.map((row) => row.kioskId)).size,
        components: [...components.values()].sort((a, b) =>
          a.domain.localeCompare(b.domain),
        ),
        completed: countBy(batch, 'COMPLETED'),
        failed: countBy(batch, 'FAILED'),
        open: countBy(batch, 'SENT'),
        canceled: countBy(batch, 'CANCELED'),
        rows: batch,
      };
    })
    .sort((a, b) => b.at - a.at);
}

/** 손댈 것이 남아 있는가 — 실패했거나 결론이 안 왔다. */
export const needsAttention = (batch: BatchSummary): boolean =>
  batch.failed > 0 || batch.open > 0;

/** 취소할 수 있는 행 — 서버가 `SENT` 만 받는다. */
export const cancellable = (batch: BatchSummary): readonly Deployment[] =>
  batch.rows.filter((row) => row.status === 'SENT');
