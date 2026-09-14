import { useMemo, useState } from 'react';
import {
  type Deployment,
  describeState,
  type KioskHealth,
  type Tier,
} from './fleet';
import { Caret } from './Icon';
import type { GroupAxis } from './TargetFilters';
import type { Kiosk } from './types';

const NO_ACCOMMODATION = '업장 미상';
const NO_TIER = '미배정';

/**
 * 업장(또는 티어) → 키오스크 트리.
 *
 * 평평한 목록은 수백 대에서 훑을 수 없다 — 같은 업장 것이 흩어져 있으면 "이 호텔만
 * 갱신"이라는 가장 흔한 작업이 스크롤 노동이 된다.
 *
 * 묶는 축이 둘인 것은 같은 목록을 다르게 접는 것뿐이다. 그래서 **행이 지는 정보도 축을
 * 따라 바뀐다** — 업장으로 접었으면 그 기기의 티어가, 티어로 접었으면 어느 업장인지가
 * 궁금한 값이다. 둘 다 보여주면 촘촘한 행이 무너진다.
 *
 * 실재(버전 조합)는 배지로 요약하고 전문은 `title` 이 진다. 도메인 열을 늘어놓으면
 * 수백 대에서 아무도 읽지 않는다.
 */
export function KioskTree({
  kiosks,
  selected,
  onChange,
  axis,
  tiersOf,
  deploymentsOf,
  healths,
}: {
  kiosks: readonly Kiosk[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  axis: GroupAxis;
  /** 이 기기가 속한 티어들. 비면 미배정(티어 배포에서 빠진다). */
  tiersOf: (kiosk: Kiosk) => readonly Tier[];
  deploymentsOf: (kioskId: string) => readonly Deployment[];
  healths: ReadonlyMap<string, KioskHealth>;
}) {
  const groups = useMemo(() => {
    const byKey = new Map<string, Kiosk[]>();
    const put = (name: string, kiosk: Kiosk) => {
      const found = byKey.get(name);
      if (found) found.push(kiosk);
      else byKey.set(name, [kiosk]);
    };
    for (const kiosk of kiosks) {
      if (axis !== 'tier') {
        put(kiosk.accommodationName ?? NO_ACCOMMODATION, kiosk);
        continue;
      }
      // 중복 소속이 허용되므로 한 기기가 여러 티어에 뜬다. 선택은 id 기준이라 어디서
      // 체크하든 같은 기기다 — 감추면 "이 티어에 뭐가 들었나"가 거짓이 된다.
      const tiers = tiersOf(kiosk);
      if (tiers.length === 0) put(NO_TIER, kiosk);
      else for (const tier of tiers) put(tier.name, kiosk);
    }
    // 서버가 차수 순서를 들지 않는다 — 이름순이 유일하게 안정적인 순서다.
    return [...byKey.entries()]
      .map(([name, list]) => ({ name, kiosks: list }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [kiosks, axis, tiersOf]);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = (name: string) => {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsed(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleAllIn = (list: readonly Kiosk[]) => {
    const next = new Set(selected);
    const allChosen = list.every((kiosk) => next.has(kiosk.id));
    for (const kiosk of list) {
      if (allChosen) next.delete(kiosk.id);
      else next.add(kiosk.id);
    }
    onChange(next);
  };

  if (kiosks.length === 0) {
    return (
      <div className="tree">
        <p className="pane-note">볼 수 있는 키오스크가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="tree">
      {groups.map((group) => {
        const chosen = group.kiosks.filter((kiosk) =>
          selected.has(kiosk.id),
        ).length;
        const troubled = group.kiosks.filter((kiosk) => {
          const health = healths.get(kiosk.id);
          return health && (health.failed > 0 || health.pending > 0);
        }).length;
        const open = !collapsed.has(group.name);

        return (
          <div className="group" key={group.name}>
            <div className="group-head">
              <button
                type="button"
                className="caret-btn"
                onClick={() => toggleGroup(group.name)}
                aria-label={open ? '접기' : '펼치기'}
              >
                <Caret open={open} />
              </button>
              <input
                type="checkbox"
                checked={chosen === group.kiosks.length}
                aria-label={`${group.name} 전체`}
                // 일부만 골랐다는 것은 체크박스로 표현할 수 없다 — 중간 상태로 알린다.
                ref={(node) => {
                  if (node)
                    node.indeterminate =
                      chosen > 0 && chosen < group.kiosks.length;
                }}
                onChange={() => toggleAllIn(group.kiosks)}
              />
              {/* 위 버튼·체크박스가 같은 일을 키보드로 한다 */}
              <span
                className="group-name"
                onClick={() => toggleGroup(group.name)}
              >
                {group.name}
              </span>
              {/* 접힌 채로도 손댈 곳이 보여야 펼칠 이유를 안다. */}
              {troubled > 0 && <span className="tally bad">{troubled}</span>}
              <span className="count">
                {chosen}/{group.kiosks.length}
              </span>
            </div>

            {open &&
              group.kiosks.map((kiosk) => {
                const tiers = tiersOf(kiosk);
                const health = healths.get(kiosk.id);
                return (
                  <label
                    className={
                      kiosk.connectionState === 'connected'
                        ? 'kiosk'
                        : 'kiosk off'
                    }
                    key={kiosk.id}
                    title={describeState(
                      kiosk.versions,
                      deploymentsOf(kiosk.id),
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(kiosk.id)}
                      onChange={() => toggleOne(kiosk.id)}
                    />
                    <span>{kiosk.name}</span>

                    {health && health.failed > 0 && (
                      <em className="mark bad">✕{health.failed}</em>
                    )}
                    {/* 미적용·미보고는 실패가 아니라 "아직/모른다"라 회색조다. */}
                    {health && health.pending > 0 && (
                      <em className="mark">…{health.pending}</em>
                    )}
                    {health?.silent && (
                      <em className="mark faint" title="상태 보고가 없습니다">
                        ?
                      </em>
                    )}

                    {/* 축이 지지 않는 쪽을 행이 진다 — 둘 다 보여주면 행이 무너진다. */}
                    {axis === 'tier' ? (
                      <em className="tier is-on">
                        {kiosk.accommodationName ?? NO_ACCOMMODATION}
                      </em>
                    ) : (
                      <em className={tiers.length > 0 ? 'tier is-on' : 'tier'}>
                        {tiers.length > 0
                          ? tiers.map((tier) => tier.name).join(' · ')
                          : NO_TIER}
                      </em>
                    )}
                    <i className={`dot ${kiosk.connectionState}`} />
                  </label>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
