import { TARGET_FILTER, TARGET_FILTER_LABEL, type TargetFilter } from './fleet';

/**
 * 대상 열의 칩과 묶는 축.
 *
 * 칩은 **좁히는 것**이지 세는 것이 아니다 — 수백 대에서 손댈 곳을 찾는 유일한 수단이라
 * 숫자만 보여주고 못 누르게 두면 아무 쓸모가 없었다(그래서 자리만 잡아뒀던 것을 걷어냈다).
 *
 * 묶는 축이 둘인 이유: 평소 작업은 업장 경계로 갈리지만, 차수 배포를 짤 때는 "카나리에
 * 무엇이 들어 있나"를 봐야 한다. 같은 목록을 다르게 접는 것뿐이라 선택은 유지된다.
 */

export type GroupAxis = 'accommodation' | 'tier';

const AXIS_LABEL: Record<GroupAxis, string> = {
  accommodation: '업장',
  tier: '티어',
};

const ORDER: readonly TargetFilter[] = [
  TARGET_FILTER.ALL,
  TARGET_FILTER.CONNECTED,
  TARGET_FILTER.OFFLINE,
  TARGET_FILTER.TROUBLE,
  TARGET_FILTER.SILENT,
];

/**
 * 이상·미보고는 0 이어도 칩을 남긴다 — 없다는 것도 정보다. 강조만 끈다.
 *
 * 빨강이 붙는 것은 "이상"뿐이다. 미보고는 나쁜 소식이 아니라 **모른다**는 뜻이라, 이
 * 화면의 색 문법(파랑=고른 것, 초록=성공, 빨강=실패, 나머지 회색조)에서 회색이 맞다.
 */
const ACCENT: Partial<Record<TargetFilter, string>> = {
  [TARGET_FILTER.TROUBLE]: 'is-bad',
};

export function TargetFilters({
  counts,
  filter,
  onFilter,
  axis,
  onAxis,
  selected,
}: {
  counts: Readonly<Record<TargetFilter, number>>;
  filter: TargetFilter;
  onFilter: (next: TargetFilter) => void;
  axis: GroupAxis;
  onAxis: (next: GroupAxis) => void;
  selected: number;
}) {
  return (
    <>
      <div className="chips">
        {ORDER.map((key) => {
          const accent = counts[key] > 0 ? (ACCENT[key] ?? '') : '';
          return (
            <button
              key={key}
              type="button"
              className={`chip ${filter === key ? 'is-on' : ''} ${accent}`}
              onClick={() => onFilter(key)}
            >
              {TARGET_FILTER_LABEL[key]} {counts[key]}
            </button>
          );
        })}
        {/* 줄바꿈하는 줄에서는 spacer 를 쓰지 않는다 — 접힌 줄을 통째로 밀어낸다. */}
        <span className="chip is-accent">선택 {selected}</span>
      </div>

      <div className="chips" style={{ paddingTop: 0 }}>
        <span className="pane-title">묶기</span>
        <div className="modes" style={{ flexGrow: 1 }}>
          {(['accommodation', 'tier'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={axis === key ? 'mode is-on' : 'mode'}
              onClick={() => onAxis(key)}
            >
              {AXIS_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
