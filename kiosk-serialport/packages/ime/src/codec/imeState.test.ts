import { describe, expect, it } from 'bun:test';
import type { RawImeContext } from '../engine/ImeEngine';
import { toImeState } from './imeState';

describe('toImeState', () => {
  it('빈 조합 → composing=false, highlightedIndex=-1', () => {
    const ctx: RawImeContext = {
      preedit: null,
      candidates: [],
      highlightedIndex: 0,
    };
    expect(toImeState(ctx, null)).toEqual({
      committedText: '',
      preedit: '',
      candidates: [],
      highlightedIndex: -1,
      composing: false,
    });
  });

  it('조합 중 → preedit/후보 유지, composing=true', () => {
    const ctx: RawImeContext = {
      preedit: 'ni hao',
      candidates: ['你好', '妳好', '逆號'],
      highlightedIndex: 0,
    };
    expect(toImeState(ctx, null)).toEqual({
      committedText: '',
      preedit: 'ni hao',
      candidates: [{ text: '你好' }, { text: '妳好' }, { text: '逆號' }],
      highlightedIndex: 0,
      composing: true,
    });
  });

  it('전체 확정 → committedText 채움, 조합 종료', () => {
    const ctx: RawImeContext = {
      preedit: null,
      candidates: [],
      highlightedIndex: 0,
    };
    const state = toImeState(ctx, '你好嗎');
    expect(state.committedText).toBe('你好嗎');
    expect(state.composing).toBe(false);
    expect(state.preedit).toBe('');
    expect(state.candidates).toEqual([]);
  });

  it('부분 선택 후 전진 → commit 없이 preedit/후보 잔류(composing)', () => {
    const ctx: RawImeContext = {
      preedit: '你好ma',
      candidates: ['嗎', '嘛', '馬'],
      highlightedIndex: 0,
    };
    const state = toImeState(ctx, null);
    expect(state.committedText).toBe('');
    expect(state.preedit).toBe('你好ma');
    expect(state.candidates).toEqual([
      { text: '嗎' },
      { text: '嘛' },
      { text: '馬' },
    ]);
    expect(state.composing).toBe(true);
    expect(state.highlightedIndex).toBe(0);
  });
});
