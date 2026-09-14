import { describe, expect, it } from 'bun:test';
import { projectOutput } from './projection';
import type { MozcOutput } from './proto/commands';

const outputOf = (partial: Partial<MozcOutput>): MozcOutput => ({
  id: null,
  consumed: true,
  errorCode: 0,
  result: null,
  preedit: null,
  candidateWindow: null,
  ...partial,
});

describe('projectOutput', () => {
  it('확정 응답 → commit 만, ctx 는 빈 상태', () => {
    const { ctx, commit, candidateIds } = projectOutput(
      outputOf({ result: '今日' }),
    );
    expect(commit).toBe('今日');
    expect(ctx).toEqual({
      preedit: null,
      candidates: [],
      highlightedIndex: -1,
    });
    expect(candidateIds).toEqual([]);
  });

  it('조합 중 → 세그먼트 join + 후보 + 전역 focused_index 의 창내 매핑', () => {
    const { ctx, commit, candidateIds } = projectOutput(
      outputOf({
        preedit: { cursor: 3, segments: ['きょ', 'う'] },
        candidateWindow: {
          focusedIndex: 10, // 페이징으로 창이 index 9 부터 시작하는 상황
          size: 30,
          candidates: [
            { index: 9, value: '今日', id: 0 },
            { index: 10, value: '京', id: 2 },
            { index: 11, value: 'きょう', id: 4 },
          ],
        },
      }),
    );
    expect(commit).toBeNull();
    expect(ctx).toEqual({
      preedit: 'きょう',
      candidates: ['今日', '京', 'きょう'],
      highlightedIndex: 1,
    });
    expect(candidateIds).toEqual([0, 2, 4]);
  });

  it('메타 항목(음수 id)·id 미제공 후보는 필터 — 스트립 전 항목 탭 가능 보장', () => {
    const { ctx, candidateIds } = projectOutput(
      outputOf({
        preedit: { cursor: 4, segments: ['どよとみ'] },
        candidateWindow: {
          focusedIndex: 1,
          size: 4,
          candidates: [
            { index: 0, value: '土与富', id: 0 },
            { index: 1, value: '度よ富', id: 1 },
            { index: 2, value: 'id없음', id: null },
            { index: 3, value: 'そのほかの文字種', id: -1 }, // 모바일 UI 메타(실측 -1)
          ],
        },
      }),
    );
    expect(ctx.candidates).toEqual(['土与富', '度よ富']);
    expect(candidateIds).toEqual([0, 1]);
    expect(ctx.highlightedIndex).toBe(1); // 필터 후 재매핑된 위치
  });

  it('focused 가 필터된 항목을 가리키면 -1', () => {
    const { ctx } = projectOutput(
      outputOf({
        candidateWindow: {
          focusedIndex: 1,
          size: 2,
          candidates: [
            { index: 0, value: 'あ', id: 1 },
            { index: 1, value: 'メタ', id: -1 },
          ],
        },
      }),
    );
    expect(ctx.candidates).toEqual(['あ']);
    expect(ctx.highlightedIndex).toBe(-1);
  });

  it('포커스 없는 suggestion / 창 밖 focused → -1', () => {
    const window = {
      size: 2,
      candidates: [
        { index: 0, value: 'あ', id: 1 },
        { index: 1, value: '亜', id: 2 },
      ],
    };
    expect(
      projectOutput(
        outputOf({ candidateWindow: { ...window, focusedIndex: null } }),
      ).ctx.highlightedIndex,
    ).toBe(-1);
    expect(
      projectOutput(
        outputOf({ candidateWindow: { ...window, focusedIndex: 99 } }),
      ).ctx.highlightedIndex,
    ).toBe(-1);
  });

  it('빈 Output → 전부 빈 상태 (toImeState 가 composing=false 로 수렴)', () => {
    expect(projectOutput(outputOf({}))).toEqual({
      ctx: { preedit: null, candidates: [], highlightedIndex: -1 },
      commit: null,
      candidateIds: [],
    });
  });
});
