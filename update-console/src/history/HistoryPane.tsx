import { useState } from 'react';
import type { Deployment } from '../fleet';
import type { Kiosk } from '../types';
import {
  type BatchSummary,
  cancellable,
  groupBatches,
  needsAttention,
} from './batches';

/**
 * 배포 이력 — **발송 단위**로 접어서 본다.
 *
 * 행을 그대로 늘어놓으면 100대 배포 하나가 화면을 다 먹고 그 앞뒤가 안 보인다. 사람이
 * 기억하는 단위는 "그때 그 배포"이므로 그 알갱이로 접고, 궁금할 때만 편다.
 *
 * 취소 버튼이 여기 있는 이유: **영영 오지 않을 결과**를 기다리는 행이 실제로 생긴다
 * (옛 펌웨어 기기, 폐기된 키오스크). 닫을 방법이 없으면 판정이 계속 "이상"으로 잡아
 * 진짜 문제를 덮는다.
 */

const STATUS_LABEL: Record<Deployment['status'], string> = {
  SENT: '보냄',
  COMPLETED: '완료',
  FAILED: '실패',
  CANCELED: '취소',
};

const STATUS_TONE: Record<Deployment['status'], string> = {
  SENT: 'cell wait',
  COMPLETED: 'cell ok',
  FAILED: 'cell bad',
  CANCELED: 'cell none',
};

const when = (ms: number): string => new Date(ms).toLocaleString('ko-KR');

export function HistoryPane({
  rows,
  kiosks,
  hasMore,
  busy,
  onMore,
  onCancel,
  onClose,
}: {
  rows: readonly Deployment[];
  kiosks: readonly Kiosk[];
  hasMore: boolean;
  busy: boolean;
  onMore: () => void;
  /** 미결 행 하나를 닫는다. 여러 개면 호출부가 순서대로 돈다. */
  onCancel: (deployments: readonly Deployment[]) => void;
  onClose: () => void;
}) {
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  const nameOf = (kioskId: string): string =>
    kiosks.find((kiosk) => kiosk.id === kioskId)?.name ?? kioskId;

  const batches = groupBatches(rows).filter(
    (batch) => !onlyAttention || needsAttention(batch),
  );

  const toggle = (batchId: string) => {
    const next = new Set(opened);
    if (next.has(batchId)) next.delete(batchId);
    else next.add(batchId);
    setOpened(next);
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="detail matrix"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-head">
          <h2 className="pane-title">배포 이력</h2>
          <span className="note">발송 {batches.length}건</span>
          <span className="spacer" />
          <label className="inline">
            <input
              type="checkbox"
              checked={onlyAttention}
              onChange={(event) => setOnlyAttention(event.target.checked)}
            />
            손댈 것만
          </label>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="detail-body matrix-body">
          {batches.length === 0 ? (
            <p className="pane-note">
              {rows.length === 0
                ? '아직 배포 기록이 없습니다.'
                : '손댈 것이 남은 발송이 없습니다.'}
            </p>
          ) : (
            <div className="history">
              {batches.map((batch) => (
                <BatchRow
                  key={batch.batchId}
                  batch={batch}
                  open={opened.has(batch.batchId)}
                  busy={busy}
                  nameOf={nameOf}
                  onToggle={() => toggle(batch.batchId)}
                  onCancel={() => onCancel(cancellable(batch))}
                />
              ))}
            </div>
          )}
        </div>

        <div className="detail-foot">
          <span className="note">
            {rows.length}행 불러옴 · 발송 하나가 기기 수 × 컴포넌트 수만큼의
            행입니다
          </span>
          <span className="spacer" />
          <button type="button" onClick={onMore} disabled={busy || !hasMore}>
            더 보기
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchRow({
  batch,
  open,
  busy,
  nameOf,
  onToggle,
  onCancel,
}: {
  batch: BatchSummary;
  open: boolean;
  busy: boolean;
  nameOf: (kioskId: string) => string;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const stuck = cancellable(batch).length;

  return (
    <div className={needsAttention(batch) ? 'batch is-open' : 'batch'}>
      <div className="batch-head" onClick={onToggle}>
        <span className="when mono">{when(batch.at)}</span>
        <span className="who">{batch.by ?? '시스템'}</span>
        <span className="what mono">
          {batch.components
            .map(({ domain, version }) => `${domain} ${version}`)
            .join(' · ')}
        </span>
        <span className="spacer" />
        <span className="note">{batch.kiosks}대</span>
        {batch.completed > 0 && (
          <span className="tally ok">완료 {batch.completed}</span>
        )}
        {batch.failed > 0 && (
          <span className="tally bad">실패 {batch.failed}</span>
        )}
        {batch.open > 0 && <span className="tally">미결 {batch.open}</span>}
        {batch.canceled > 0 && (
          <span className="tally">취소 {batch.canceled}</span>
        )}
        {stuck > 0 && (
          <button
            type="button"
            disabled={busy}
            title="결론이 오지 않는 행을 닫습니다 — 옛 펌웨어나 폐기된 기기"
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
          >
            미결 {stuck} 취소
          </button>
        )}
      </div>

      {open && (
        <table className="matrix-table">
          <tbody>
            {batch.rows.map((row) => (
              <tr key={row.id}>
                <th className="stick">
                  <span className="who">{nameOf(row.kioskId)}</span>
                </th>
                <td className="cell">{row.domain}</td>
                <td className="cell">
                  {row.previousVersion ? `${row.previousVersion} → ` : ''}
                  {row.version}
                </td>
                <td className={STATUS_TONE[row.status]}>
                  {STATUS_LABEL[row.status]}
                </td>
                <td className="cell none">{row.errorMessage ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
