import { useState } from 'react';
import { countBy, failedIds, type Result, type Status } from '../dispatch';
import type { Kiosk } from '../types';

/** 사람이 봐야 할 것이 위로 온다 — 실패, 도는 중, 아직, 성공 순. */
const ORDER: Record<Status, number> = {
  failed: 0,
  sending: 1,
  pending: 2,
  ok: 3,
};

const NO_ACCOMMODATION = '업장 미상';

export type ResultsPaneProps = {
  /** 행이 쪽 상한에 잘렸는가 — 아래 집계가 일부만 센 값이라는 뜻이다. */
  truncated: boolean;
  /** 기다리기를 그만뒀는가 — 영영 답하지 않는 기기가 있다. */
  gaveUp: boolean;
  results: Result[] | null;
  byId: ReadonlyMap<string, Kiosk>;
  /** 무엇의 결과인가 — 적용과 롤백은 같은 열을 쓴다. */
  action: 'apply' | 'rollback';
  busy: boolean;
  onRetryFailed: () => void;
};

/**
 * 결과 열 — 세 탭이 공유한다.
 *
 * **적용의 "성공"은 키오스크가 실제로 끝냈다는 뜻이다** — 서버 배포 행의 status 를 그린다.
 * 접수만으로는 아무것도 안 끝났으므로, 보낸 직후에는 전부 「도는 중」이고 키오스크가
 * 홈에서 적용한 뒤에야 초록이 된다(몇 분 걸릴 수 있다).
 *
 * 롤백만 예외다 — 서버에 행이 없어 접수까지만 안다.
 *
 * 수백 대를 한 줄씩 세는 대신 업장 단위로 접고, 실패가 있는 곳이 위로 온다.
 */
export function ResultsPane({
  truncated,
  gaveUp,
  results,
  byId,
  action,
  busy,
  onRetryFailed,
}: ResultsPaneProps) {
  const [onlyFailed, setOnlyFailed] = useState(false);

  if (!results) {
    return <p className="pane-note">아직 보낸 지시가 없습니다.</p>;
  }

  const shown = onlyFailed
    ? results.filter((result) => result.status === 'failed')
    : results;

  const byName = new Map<string, Result[]>();
  for (const result of shown) {
    const name = byId.get(result.id)?.accommodationName ?? NO_ACCOMMODATION;
    const list = byName.get(name);
    if (list) list.push(result);
    else byName.set(name, [result]);
  }
  const groups = [...byName.entries()]
    .map(([name, list]) => ({
      name,
      list: [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status]),
      failed: list.filter((result) => result.status === 'failed').length,
      ok: list.filter((result) => result.status === 'ok').length,
    }))
    .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name, 'ko'));

  const done = countBy(results, 'ok') + countBy(results, 'failed');
  /**
   * 다시 보낼 대상 수. 적용은 결론이 안 온 것도 포함한다 — 새 지시가 옛 것을 덮으므로
   * 두 번 적용되지 않는다.
   */
  const retryCount =
    action === 'apply'
      ? results.filter((result) => result.status !== 'ok').length
      : failedIds(results).length;

  return (
    <>
      <div className="pane-head">
        <h2 className="pane-title">
          결과 · {action === 'rollback' ? '롤백' : '적용'}
        </h2>
        <span className="spacer" />
        <span className="tally ok">성공 {countBy(results, 'ok')}</span>
        <span className="tally bad">실패 {countBy(results, 'failed')}</span>
        <span className="tally">
          남음 {countBy(results, 'pending') + countBy(results, 'sending')}
        </span>
      </div>

      <div className="progress">
        <div className="progress-line">
          <span>
            보낸 지시{' '}
            <b>
              {done} / {results.length}
            </b>
          </span>
          <b>{Math.round((done / results.length) * 100)}%</b>
        </div>
        <div className="track">
          <i
            className="fill-ok"
            style={{
              width: `${(countBy(results, 'ok') / results.length) * 100}%`,
            }}
          />
          <i
            className="fill-bad"
            style={{
              width: `${(countBy(results, 'failed') / results.length) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="result-tools">
        <label className="inline">
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(event) => setOnlyFailed(event.target.checked)}
          />
          실패만
        </label>
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={busy || retryCount === 0}
          title={
            action === 'apply'
              ? '실패한 것과 결론이 오지 않은 것을 다시 보냅니다'
              : '접수가 실패한 것만 다시 보냅니다'
          }
        >
          {action === 'apply' ? '안 끝난 것만 재시도' : '실패한 것만 재시도'}
          {retryCount > 0 && ` (${retryCount})`}
        </button>
      </div>

      <div className="results">
        {groups.map((group) => (
          <div key={group.name}>
            <div className="result-group">
              <span>{group.name}</span>
              <span className="tally ok">{group.ok}</span>
              {group.failed > 0 && (
                <span className="tally bad">{group.failed}</span>
              )}
            </div>
            {group.list.map((result) => (
              <div key={result.id} className={`result ${result.status}`}>
                <span className="who">
                  {byId.get(result.id)?.name ?? result.id}
                </span>
                <em>{result.status}</em>
                {result.error && (
                  <code title={result.error}>{result.error}</code>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {truncated && (
        <p className="pane-note error">
          발송이 커서 일부 행만 불러왔습니다 — 위 집계는 그 일부입니다. 전체는
          「이력」에서 보세요.
        </p>
      )}
      {gaveUp && (
        <p className="pane-note error">
          10분 동안 결론이 오지 않아 기다리기를 멈췄습니다. 꺼져 있거나 옛
          펌웨어인 기기일 수 있습니다 — 「이력」에서 확인하고 필요하면 미결을
          취소하세요.
        </p>
      )}
      <p className="pane-note">
        {action === 'apply'
          ? '키오스크는 홈 화면에서 한가할 때 적용합니다 — 결과가 오기까지 몇 분 걸릴 수 있고, 이 열은 5초마다 스스로 갱신됩니다.'
          : '롤백은 서버에 기록이 없어 접수까지만 알 수 있습니다. 실제 결과는 「버전 현황」에서 확인하세요.'}
      </p>
    </>
  );
}
