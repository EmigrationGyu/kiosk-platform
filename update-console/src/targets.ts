import type { Kiosk } from './types';

const NO_ACCOMMODATION = '업장 미상';

export type TargetGroup = { name: string; count: number };

/**
 * 고른 키오스크를 업장 단위로 센다 — 확인 화면의 재료.
 *
 * 수백 대를 한 줄씩 보여주면 아무도 읽지 않는다. 업장 이름과 대수만 보이면 "어느 업장을
 * 건드리는가"가 한눈에 들어온다. 많은 쪽이 위, 같으면 이름순.
 */
export function summarizeTargets(
  kiosks: readonly Kiosk[],
  selected: ReadonlySet<string>,
): TargetGroup[] {
  const counts = new Map<string, number>();
  for (const kiosk of kiosks) {
    if (!selected.has(kiosk.id)) continue;
    const name = kiosk.accommodationName ?? NO_ACCOMMODATION;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}
