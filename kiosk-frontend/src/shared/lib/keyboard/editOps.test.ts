import { describe, expect, it } from 'bun:test';
import { BACKSPACE_KEY, SPACE_KEY } from '@/shared/constants/keyboard';
import { applyBackspace, applyInsert, type EditState } from './editOps';

// collapsed 커서 상태 축약 생성자
const at = (value: string, caret: number, composing = false): EditState => ({
  value,
  start: caret,
  end: caret,
  composing,
});

// 범위 선택 상태 축약 생성자
const sel = (
  value: string,
  start: number,
  end: number,
  composing = false,
): EditState => ({ value, start, end, composing });

// 키 시퀀스를 순차 적용(반환된 caret/composing 을 다음 상태로 스레딩) — 연속 타이핑 모사.
// BACKSPACE_KEY 는 백스페이스로 해석한다.
const typeKeys = (initial: EditState, keys: string[]) =>
  keys.reduce(
    (state, key) => {
      const outcome =
        key === BACKSPACE_KEY ? applyBackspace(state) : applyInsert(state, key);
      return { ...outcome, start: outcome.caret, end: outcome.caret };
    },
    { ...initial, caret: initial.start },
  );

describe('applyInsert — 문자열 끝(tail) 연속 타이핑 (기존 동작 파리티)', () => {
  it('한글 자소를 연속 조합한다: ㄱ+ㅏ+ㄴ → 간', () => {
    const r = typeKeys(at('', 0), ['ㄱ', 'ㅏ', 'ㄴ']);
    expect(r.value).toBe('간');
    expect(r.caret).toBe(1);
    expect(r.composing).toBe(true);
  });

  it('도깨비불: 간 + ㅏ → 가나 (병합 결과가 2글자로 늘며 커서도 따라간다)', () => {
    const r = applyInsert(at('간', 1, true), 'ㅏ');
    expect(r.value).toBe('가나');
    expect(r.caret).toBe(2);
  });

  it('받침 병합: 가 + ㅁ → 감', () => {
    const r = applyInsert(at('가', 1, true), 'ㅁ');
    expect(r.value).toBe('감');
    expect(r.caret).toBe(1);
  });

  it('공백은 삽입 후 조합을 끝낸다 — 다음 키는 앞 글자와 병합하지 않는다', () => {
    const r = typeKeys(at('', 0), ['ㄱ', 'ㅏ', SPACE_KEY, 'ㄴ']);
    expect(r.value).toBe('가 ㄴ');
    expect(r.composing).toBe(true);
  });

  it('라틴 문자는 es-hangul 이 throw 해도 폴백으로 이어붙인다: a + b → ab', () => {
    const r = typeKeys(at('', 0), ['a', 'b']);
    expect(r.value).toBe('ab');
    expect(r.caret).toBe(2);
  });
});

describe('applyInsert — 커서 위치 삽입', () => {
  it('비조합 상태에서 중간 삽입은 병합 없이 단독 삽입된다', () => {
    const r = applyInsert(at('abc', 1), 'x');
    expect(r.value).toBe('axbc');
    expect(r.caret).toBe(2);
  });

  it('조합한 적 없는 글자 뒤에 모음을 쳐도 앞 글자가 변형되지 않는다: 간|글 + ㅏ → 간ㅏ글', () => {
    // tail 전용 구현의 잠재 버그(무조건 병합 → '가나글') 가 플래그 게이트로 닫혔음을 박제
    const r = applyInsert(at('간글', 1, false), 'ㅏ');
    expect(r.value).toBe('간ㅏ글');
    expect(r.caret).toBe(2);
  });

  it('조합 중이면 커서 앞 글자와 병합하고 뒤 텍스트는 보존된다: 가|나 + ㅁ → 감나', () => {
    const r = applyInsert(at('가나', 1, true), 'ㅁ');
    expect(r.value).toBe('감나');
    expect(r.caret).toBe(1);
  });

  it('조합 중 도깨비불이 중간에서 일어나도 커서가 병합 결과 끝에 놓인다: 간|들 + ㅏ → 가나들', () => {
    const r = applyInsert(at('간들', 1, true), 'ㅏ');
    expect(r.value).toBe('가나들');
    expect(r.caret).toBe(2);
  });

  it('문두(커서 0) 삽입은 조합 플래그와 무관하게 단독 삽입된다', () => {
    const r = applyInsert(at('나', 0, true), 'ㄱ');
    expect(r.value).toBe('ㄱ나');
    expect(r.caret).toBe(1);
  });
});

describe('applyBackspace — 문자열 끝(tail) (기존 동작 파리티)', () => {
  it('조합 중이면 자소 단위로 지운다: 간 → 가 → ㄱ → (빈 값, 조합 종료)', () => {
    const s1 = applyBackspace(at('간', 1, true));
    expect(s1.value).toBe('가');
    expect(s1.composing).toBe(true);

    const s2 = applyBackspace(at(s1.value, s1.caret, s1.composing));
    expect(s2.value).toBe('ㄱ');
    expect(s2.composing).toBe(true);

    const s3 = applyBackspace(at(s2.value, s2.caret, s2.composing));
    expect(s3.value).toBe('');
    expect(s3.composing).toBe(false);
  });

  it('비조합이면 글자 단위로 지운다: 간 → (빈 값)', () => {
    const r = applyBackspace(at('간', 1, false));
    expect(r.value).toBe('');
    expect(r.caret).toBe(0);
  });

  it('빈 값에서는 no-op', () => {
    const r = applyBackspace(at('', 0, false));
    expect(r.value).toBe('');
    expect(r.caret).toBe(0);
  });
});

describe('applyBackspace — 커서 위치 삭제', () => {
  it('커서 앞 글자만 지우고 뒤 텍스트는 보존된다: a|bc → |bc', () => {
    const r = applyBackspace(at('abc', 1));
    expect(r.value).toBe('bc');
    expect(r.caret).toBe(0);
  });

  it('조합 중 중간 백스페이스도 자소 단위: 간|나 → 가나', () => {
    const r = applyBackspace(at('간나', 1, true));
    expect(r.value).toBe('가나');
    expect(r.caret).toBe(1);
    expect(r.composing).toBe(true);
  });

  it('문두(커서 0)에서는 no-op', () => {
    const r = applyBackspace(at('abc', 0));
    expect(r.value).toBe('abc');
    expect(r.caret).toBe(0);
  });
});

describe('범위 선택', () => {
  it('입력은 선택 범위를 교체한다: a[bc]d + x → axd', () => {
    const r = applyInsert(sel('abcd', 1, 3), 'x');
    expect(r.value).toBe('axd');
    expect(r.caret).toBe(2);
  });

  it('선택 교체는 조합 중이어도 앞 글자와 병합하지 않는다(새 조합 시작)', () => {
    const r = applyInsert(sel('가나다', 1, 2, true), 'ㅏ');
    expect(r.value).toBe('가ㅏ다');
    expect(r.caret).toBe(2);
    expect(r.composing).toBe(true);
  });

  it('백스페이스는 선택 범위만 지우고 조합을 끝낸다: a[bc]d → ad', () => {
    const r = applyBackspace(sel('abcd', 1, 3, true));
    expect(r.value).toBe('ad');
    expect(r.caret).toBe(1);
    expect(r.composing).toBe(false);
  });

  it('전체 선택 후 입력은 값 전체를 교체한다', () => {
    const r = applyInsert(sel('전체선택', 0, 4), 'ㄱ');
    expect(r.value).toBe('ㄱ');
    expect(r.caret).toBe(1);
  });
});

describe('선택 범위 정규화', () => {
  it('경계 밖 범위는 값 길이로 클램프된다', () => {
    const r = applyInsert(sel('ab', -2, 99), 'x');
    expect(r.value).toBe('x');
    expect(r.caret).toBe(1);
  });

  it('역전된 범위(start > end)는 교정된다', () => {
    const r = applyBackspace(sel('abcd', 3, 1));
    expect(r.value).toBe('ad');
    expect(r.caret).toBe(1);
  });
});
