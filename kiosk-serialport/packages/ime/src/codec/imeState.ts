import type { ImeState } from 'kiosk-types';
import type { RawImeContext } from '../engine/ImeEngine';

/**
 * 디코드된(엔진-중립) rime context + commit 텍스트 → 프론트 계약 ImeState.
 * 순수함수: 엔진(impure)이 값을 주입하고 여기선 매핑만 한다. 어떤 엔진이든 공통으로 쓴다.
 * - commit 이 있으면 committedText 로, 없으면 "".
 * - 후보가 없으면 highlightedIndex 는 -1 로 정규화.
 * - preedit 또는 후보가 남아 있으면 조합 진행 중(composing).
 */
export function toImeState(
  ctx: RawImeContext,
  commitText: string | null,
): ImeState {
  const preedit = ctx.preedit ?? '';
  const candidates = ctx.candidates.map((text) => ({ text }));
  return {
    committedText: commitText ?? '',
    preedit,
    candidates,
    highlightedIndex: candidates.length > 0 ? ctx.highlightedIndex : -1,
    composing: preedit !== '' || candidates.length > 0,
  };
}
