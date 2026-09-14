import type { AudioKey } from 'kiosk-types';

/**
 * 한 이벤트에 물릴 음성 한 조각.
 * - `AudioKey`(문자열) = **a11y 전용**: 접근성 모드 ON 일 때만 재생(라벨·포커스 안내 등).
 * - `{ key, always: true }` = **일반 음성**: 접근성 모드 OFF 에도 재생(화면 진입 안내처럼 모두에게 필요한 것).
 */
export type A11yAudioCue = AudioKey | { key: AudioKey; always?: boolean };

/** 한 이벤트의 음성 — 단일 cue 또는 시퀀스(모드 다른 cue 를 섞을 때 배열). */
export type A11yEventCues = A11yAudioCue | A11yAudioCue[];

/**
 * a11y 노드의 이벤트별 음성 바인딩. 없는 이벤트는 생략(undefined).
 * `(a11yKey, event) → audioKey` 매핑의 값 한 칸 (Table A 의 한 행).
 */
export interface A11yEventBinding {
  /** 마운트(화면/노드 진입) 시 — 보통 QUEUE 안내. */
  mount?: A11yEventCues;
  /** 언마운트(이탈) 시 — 보통 INTERRUPT. */
  unmount?: A11yEventCues;
  /** 누름(onPress) 시 — 즉시 피드백. */
  press?: A11yEventCues;
  /** 포커스 이동 시 — 새 라벨 즉시(INTERRUPT). */
  focus?: A11yEventCues;
}

/**
 * a11yKey → 이벤트별 음성 (Table A 매니페스트).
 *
 * **생성물**: `kiosk-audios` 의 `bun run gen:a11y:bindings` 가
 * `a11y-bindings-*.xlsx` 에서 만든다(`bindings.generated.ts`, DO NOT EDIT).
 * 빈 칸은 생략(sparse) — 바인딩 없는 a11yKey 는 항목 자체가 없고, 런타임이 무음으로 무시(`resolveCues`).
 * xlsx 칸 문법: `audioKey`(a11y 전용) · `!!audioKey`(always) · 콤마 시퀀스.
 */
export { A11Y_BINDINGS } from './bindings.generated';

/**
 * 이벤트 cues 에서 현재 모드(enabled)에 재생할 audioKey 들을 추린다.
 * a11y 모드 OFF 면 `always` cue 만, ON 이면 전부.
 */
export function resolveCues(
  cues: A11yEventCues | undefined,
  enabled: boolean,
): AudioKey[] {
  if (!cues) return [];
  const arr = Array.isArray(cues) ? cues : [cues];
  return arr
    .filter((c) => enabled || (typeof c === 'object' && c.always === true))
    .map((c) => (typeof c === 'string' ? c : c.key));
}
