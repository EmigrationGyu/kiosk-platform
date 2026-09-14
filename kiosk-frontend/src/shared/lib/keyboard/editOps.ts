import { assemble, disassemble } from 'es-hangul';
import { SPACE_KEY } from '@/shared/constants/keyboard';

// ── 커서 기준 편집 연산 (순수) ──────────────────────────────────────────────
// 소프트 키보드의 키 입력/백스페이스를 "문자열 끝"이 아닌 "커서(선택 범위) 위치" 기준으로
// 일반화한 순수 함수. DOM/React 를 모르며 (값, 선택 범위, 조합 플래그) → (새 값, 새 커서,
// 새 조합 플래그) 만 계산한다. 한글 조합(자소 병합/분해)은 커서 바로 앞 글자에만 적용된다.
//
// 병합 여부의 단일 결정자는 composing 플래그다. tail 전용이던 기존 구현은 마지막 글자와
// 무조건 병합해서, 조합한 적 없는 텍스트 뒤에 모음을 치면 '간'+'ㅏ'→'가나' 로 앞 글자가
// 변형되는 잠재 버그가 있었다(프로그램 주입 값·커서 복귀 후 입력). 커서 모델에서는
// "커서 이동 = 조합 경계" 가 필수라, 병합을 플래그로 게이트해 이 문제를 함께 닫는다.
// 연속 타이핑(입력 키마다 composing=true)의 병합 동작은 기존과 동일하다.

export type EditState = {
  value: string;
  /** selectionStart. 범위 선택(start<end)이면 입력=교체, 백스페이스=범위 삭제. */
  start: number;
  /** selectionEnd. collapsed 커서면 start 와 같다. */
  end: number;
  /** 직전 동작이 한글 조합 중이었는지 — 커서 앞 글자와의 자소 병합 허용 여부. */
  composing: boolean;
};

export type EditOutcome = {
  value: string;
  /** 결과 커서(항상 collapsed). 호출자가 setSelectionRange 로 복원한다. */
  caret: number;
  composing: boolean;
};

// 안전하게 assemble 호출 — es-hangul 은 비한글 조각(라틴 등)에 throw 하므로 폴백 필수.
const safeAssemble = (fragments: string[], fallback: string) => {
  try {
    return assemble(fragments);
  } catch {
    return fallback;
  }
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);

// 선택 범위를 값 경계 안으로 정규화(역전 범위 교정 포함). DOM selection 은 신뢰 경계 밖
// 입력은 아니지만, 값 갱신 ↔ selectionchange 사이의 순간적 불일치가 음수/초과로 새지
// 않게 여기서 한 번에 닫는다.
const normalizeSelection = (
  value: string,
  start: number,
  end: number,
): { start: number; end: number } => {
  const s = clamp(Math.min(start, end), 0, value.length);
  const e = clamp(Math.max(start, end), 0, value.length);
  return { start: s, end: e };
};

/**
 * 키 1개를 커서 위치에 삽입한다.
 *
 * - 범위 선택이면 선택을 지우고 그 자리에 삽입(병합 없음 — 새 조합 시작).
 * - collapsed + 조합 중이면 커서 앞 글자와 자소 병합(도깨비불 포함: '간'+'ㅏ'→'가나').
 * - 공백은 삽입 후 조합을 끝낸다(다음 키는 병합하지 않음).
 */
export const applyInsert = (state: EditState, key: string): EditOutcome => {
  const { value, composing } = state;
  const { start, end } = normalizeSelection(value, state.start, state.end);
  const after = value.slice(end);
  const nextComposing = key !== SPACE_KEY;

  // 범위 교체·비조합·문두 삽입 — 병합 없이 단독 삽입
  if (start !== end || !composing || start === 0) {
    const before = value.slice(0, start);
    const inserted = safeAssemble([key], key);
    return {
      value: before + inserted + after,
      caret: start + inserted.length,
      composing: nextComposing,
    };
  }

  // 조합 중 — 커서 앞 글자와 자소 병합. 병합 결과가 여러 글자로 늘 수 있어(도깨비불)
  // 커서는 결과 길이로 계산한다.
  const before = value.slice(0, start);
  const lastChar = before.slice(-1);
  const merged = safeAssemble([disassemble(lastChar), key], lastChar + key);
  return {
    value: before.slice(0, -1) + merged + after,
    caret: start - 1 + merged.length,
    composing: nextComposing,
  };
};

/**
 * 커서 위치에서 백스페이스를 적용한다.
 *
 * - 범위 선택이면 선택 범위만 삭제.
 * - collapsed + 조합 중이면 커서 앞 글자를 자소 단위로 분해 삭제('간'→'가'→'ㄱ').
 * - 비조합이면 글자 단위 삭제. 자소가 1개만 남은 글자를 지우면 조합이 끝난다.
 */
export const applyBackspace = (state: EditState): EditOutcome => {
  const { value, composing } = state;
  const { start, end } = normalizeSelection(value, state.start, state.end);

  if (start !== end) {
    return {
      value: value.slice(0, start) + value.slice(end),
      caret: start,
      composing: false,
    };
  }

  if (start === 0) {
    return { value, caret: 0, composing };
  }

  const before = value.slice(0, start);
  const after = value.slice(start);
  const prefix = before.slice(0, -1);

  if (!composing) {
    return { value: prefix + after, caret: start - 1, composing: false };
  }

  const lastChar = before.slice(-1);
  const disassembled = disassemble(lastChar);

  // 자소가 1개 이하면 글자 삭제 후 조합 종료
  if (disassembled.length <= 1) {
    return { value: prefix + after, caret: start - 1, composing: false };
  }

  // 자소가 여러 개면 마지막 자소 제거 후 재조립
  const jasoList = disassembled.split('');
  jasoList.pop();
  const reassembled = safeAssemble(jasoList, jasoList.join(''));
  return {
    value: prefix + reassembled + after,
    caret: start - 1 + reassembled.length,
    composing: true,
  };
};
