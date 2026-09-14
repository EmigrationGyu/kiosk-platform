// 디코드된 MozcOutput → 엔진-중립 RawImeContext 투영(순수). rime 의 readState 대응물.
// candidateIds 는 mozc 전용 부속물: 선택은 index 가 아니라 후보 id(SEND_COMMAND)로 하므로
// 엔진이 "표시 순번 → id" 매핑을 다음 selectCandidate 까지 들고 있어야 한다.

import type { RawImeContext } from '../ImeEngine';
import type { MozcOutput } from './proto/commands';

export type MozcProjection = {
  ctx: RawImeContext;
  commit: string | null;
  /** ctx.candidates 와 같은 순서의 후보 id — 필터를 거쳐 전 항목 탭 가능(음수/무 id 없음). */
  candidateIds: readonly number[];
};

/**
 * 후보 필터: id 없음/음수는 스트립에서 제외한다. 음수 id 는 모바일 UI 용 메타 항목
 * ("そのほかの文字種"=문자종 펼치기 버튼 등, 실측 id=-1)이라 우리 스트립에선 무의미하고
 * SUBMIT_CANDIDATE 대상도 아니다. 실후보는 창에서 항상 0 이상 id(실측).
 */
export function projectOutput(output: MozcOutput): MozcProjection {
  const cw = output.candidateWindow;
  const kept = (cw?.candidates ?? []).flatMap((c) =>
    c.id !== null && c.id >= 0 ? [{ ...c, id: c.id }] : [],
  );
  // focused_index 와 Candidate.index 는 둘 다 전역 순번 — 페이징으로 창이 중간부터 시작해도
  // index 매칭으로 창 내 위치를 얻는다. 포커스 없음(suggestion)/미발견/필터됨은 -1.
  const highlightedIndex =
    cw === null || cw.focusedIndex === null
      ? -1
      : kept.findIndex((c) => c.index === cw.focusedIndex);
  const segments = output.preedit?.segments ?? [];
  const preedit = segments.length > 0 ? segments.join('') : null;
  return {
    ctx: {
      preedit,
      candidates: kept.map((c) => c.value),
      highlightedIndex,
    },
    commit: output.result,
    candidateIds: kept.map((c) => c.id),
  };
}
