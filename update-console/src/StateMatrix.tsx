import { useMemo, useState } from 'react';
import {
  BASE_DOMAIN,
  type Deployment,
  type EntityVersion,
  isTroubled,
  type KioskHealth,
  lastReportOf,
  type Tier,
} from './fleet';
import { COMPONENTS, type Kiosk } from './types';

/**
 * 버전 현황 — 여러 대의 실재를 한 판에.
 *
 * 행마다 마우스를 올려 툴팁을 읽는 것으로는 "무엇이 어긋났나"를 못 본다. 비교는 **같은
 * 열을 세로로 훑을 때** 성립하므로, 키오스크를 행에 컴포넌트를 열에 둔다.
 *
 * 두 축을 한 칸에 겹쳐 그린다: 바탕은 **키오스크가 돈다고 말한 것**(`EntityVersion`),
 * 그 위에 **아직 안 끝난 지시**(`Deployment`)를 화살표로 얹는다. 둘을 나란히 두면 표가
 * 두 배가 되고, 하나만 그리면 "지금 뭐가 도는데 뭘 시켰는가"를 못 읽는다.
 *
 * **컴포넌트 열은 언제나 전부 그린다.** 어떤 키오스크에 그 값이 없는 것은 오류가 아니라
 * "설치본에 동봉된 것을 그대로 돌고 있다"는 뜻인데(키오스크는 baseline 을 버전으로 실을
 * 수 없다), 열을 접어버리면 그 사실이 화면에서 사라져 버그처럼 보인다.
 */

const NO_VALUE = '—';

export function StateMatrix({
  kiosks,
  selected,
  deploymentsOf,
  healths,
  tiersOf,
  onClose,
}: {
  kiosks: readonly Kiosk[];
  selected: ReadonlySet<string>;
  deploymentsOf: (kioskId: string) => readonly Deployment[];
  healths: ReadonlyMap<string, KioskHealth>;
  tiersOf: (kiosk: Kiosk) => readonly Tier[];
  onClose: () => void;
}) {
  /** 고른 것이 있으면 그것부터 본다 — 방금 보낼 대상을 확인하는 쓰임이 가장 흔하다. */
  const [onlySelected, setOnlySelected] = useState(selected.size > 0);
  const [onlyTroubled, setOnlyTroubled] = useState(false);

  const rows = useMemo(
    () =>
      kiosks
        .filter((kiosk) => !onlySelected || selected.has(kiosk.id))
        .filter((kiosk) => {
          const health = healths.get(kiosk.id);
          return !onlyTroubled || (health ? isTroubled(health) : false);
        })
        .sort(
          (a, b) =>
            (a.accommodationName ?? '').localeCompare(
              b.accommodationName ?? '',
              'ko',
            ) || a.name.localeCompare(b.name, 'ko'),
        ),
    [kiosks, selected, onlySelected, onlyTroubled, healths],
  );

  /**
   * 아는 컴포넌트를 먼저, 처음 보는 도메인을 뒤에.
   *
   * 서버는 도메인을 문자열로만 본다 — 우리가 모르는 장치가 먼저 배포될 수 있고, 그때
   * 열을 안 만들면 그 값이 화면에서 조용히 사라진다.
   */
  const columns = useMemo(() => {
    const known = new Set<string>(COMPONENTS);
    const extra = new Set<string>();
    for (const kiosk of rows) {
      for (const version of kiosk.versions) {
        if (version.domain !== BASE_DOMAIN && !known.has(version.domain)) {
          extra.add(version.domain);
        }
      }
      for (const deployment of deploymentsOf(kiosk.id)) {
        if (
          deployment.domain !== BASE_DOMAIN &&
          !known.has(deployment.domain)
        ) {
          extra.add(deployment.domain);
        }
      }
    }
    return [...COMPONENTS, ...[...extra].sort()];
  }, [rows, deploymentsOf]);

  return (
    <div className="backdrop" onClick={onClose}>
      {/* 표 안을 클릭·드래그해도 닫히지 않게 — 가로 스크롤이 잦은 화면이다. */}
      <div
        className="detail matrix"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-head">
          <h2 className="pane-title">버전 현황</h2>
          <span className="note">{rows.length}대</span>
          <span className="spacer" />
          <label className="inline">
            <input
              type="checkbox"
              checked={onlySelected}
              disabled={selected.size === 0}
              onChange={(event) => setOnlySelected(event.target.checked)}
            />
            고른 것만 {selected.size}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={onlyTroubled}
              onChange={(event) => setOnlyTroubled(event.target.checked)}
            />
            이상만
          </label>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="detail-body matrix-body">
          {rows.length === 0 ? (
            <p className="pane-note">조건에 맞는 키오스크가 없습니다.</p>
          ) : (
            <table className="matrix-table">
              <thead>
                <tr>
                  <th className="stick">키오스크</th>
                  <th>앱</th>
                  {columns.map((domain) => (
                    <th key={domain}>{domain}</th>
                  ))}
                  <th>마지막 보고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((kiosk) => (
                  <Row
                    key={kiosk.id}
                    kiosk={kiosk}
                    columns={columns}
                    deployments={deploymentsOf(kiosk.id)}
                    health={healths.get(kiosk.id)}
                    tiers={tiersOf(kiosk)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="detail-foot">
          <span className="legend ok">도는 중</span>
          <span className="legend bad">실패한 지시</span>
          <span className="legend wait">보냄 · 결론 없음</span>
          <span className="legend none">
            {NO_VALUE} 설치본에 동봉된 것을 그대로 — 오류가 아닙니다
          </span>
        </div>
      </div>
    </div>
  );
}

/** 도메인별로 실재와 열린 지시를 맞춰 둔다 — 한 칸이 둘을 겹쳐 그린다. */
function Row({
  kiosk,
  columns,
  deployments,
  health,
  tiers,
}: {
  kiosk: Kiosk;
  columns: readonly string[];
  deployments: readonly Deployment[];
  health: KioskHealth | undefined;
  tiers: readonly Tier[];
}) {
  const running = new Map<string, EntityVersion>(
    kiosk.versions
      .filter((version) => version.removedAt === null)
      .map((version) => [version.domain, version]),
  );
  const open = new Map<string, Deployment>(
    deployments.map((deployment) => [deployment.domain, deployment]),
  );
  const reportedAt = lastReportOf(kiosk.versions);

  return (
    <tr>
      <th className="stick">
        <span className="who">{kiosk.name}</span>
        <span className="sub">
          {kiosk.accommodationName ?? '업장 미상'}
          {tiers.length > 0 && ` · ${tiers.map((t) => t.name).join(' · ')}`}
        </span>
      </th>
      <Cell
        version={running.get(BASE_DOMAIN)}
        deployment={open.get(BASE_DOMAIN)}
      />
      {columns.map((domain) => (
        <Cell
          key={domain}
          version={running.get(domain)}
          deployment={open.get(domain)}
        />
      ))}
      <td className="cell">
        {reportedAt === 0 ? (
          <span className="none-text">없음</span>
        ) : health?.silent ? (
          <span className="none-text">
            {new Date(reportedAt).toLocaleDateString('ko-KR')}
          </span>
        ) : (
          new Date(reportedAt).toLocaleTimeString('ko-KR')
        )}
      </td>
    </tr>
  );
}

function Cell({
  version,
  deployment,
}: {
  version: EntityVersion | undefined;
  deployment: Deployment | undefined;
}) {
  // 실패한 지시는 실재보다 먼저 보여야 한다 — 손댈 곳이 그 칸이다.
  const tone = deployment
    ? deployment.status === 'FAILED'
      ? 'cell bad'
      : 'cell wait'
    : version
      ? 'cell ok'
      : 'cell none';

  return (
    <td className={tone} title={deployment?.errorMessage ?? undefined}>
      {version?.version ?? NO_VALUE}
      {deployment && (
        <span className="target">
          {' → '}
          {deployment.version}
        </span>
      )}
    </td>
  );
}
