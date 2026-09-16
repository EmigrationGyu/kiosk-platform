// 원본은 음성 시트에서 생성되는 키 카탈로그였다(각 키 위에 한국어 원문 주석이 붙었다).
// 실제 안내 문구는 공개할 수 없으므로 **데모 키셋으로 새로 짰다** — 구조는 원본 그대로고,
// 변수 음성의 조립 규칙을 보이기 위한 최소 매니페스트를 함께 둔다.

import { z } from 'zod';
import type { TolgeeLanguage } from './i18n';

/**
 * 음성 클립 키. a11y 바인딩이 이 키로 참조하고, 파일명이 곧 발화 계약이다 —
 * 키를 바꾸면 파일도 같이 바뀌어야 하므로, 양쪽이 갈리는 것을 카탈로그 대조가 잡는다.
 */
export const AUDIO_KEYS = {
  DEMO_HOME_ENTER: 'demo_home_enter',
  DEMO_HOME_IME_LABEL: 'demo_home_ime_label',
  DEMO_HOME_DISPENSER_LABEL: 'demo_home_dispenser_label',
  DEMO_IME_ENTER: 'demo_ime_enter',
  DEMO_DISPENSER_ENTER: 'demo_dispenser_enter',
  DEMO_DISPENSE_LABEL: 'demo_dispense_label',
  DEMO_DISPENSE_PRESS: 'demo_dispense_press',
  DEMO_DEVICE_ERROR_ENTER: 'demo_device_error_enter',

  // ── 변수 음성 ── 아래 셋만 매니페스트를 가진다(= 조립 대상). 나머지는 단일 클립.
  DEMO_DISPENSE_COUNT: 'demo_dispense_count',
  DEMO_DISPENSE_WAIT: 'demo_dispense_wait',
  DEMO_NEXT_WINDOW: 'demo_next_window',
} as const;

export type AudioKeyName = keyof typeof AUDIO_KEYS;
export type AudioKey = (typeof AUDIO_KEYS)[AudioKeyName];

/**
 * 음성 안에 들어가는 동적 변수 토큰 (언어 무관).
 * 백엔드가 매니페스트 토큰 순서대로 세그먼트와 변수 슬롯을 펼쳐 클립 시퀀스를 만든다.
 */
export const AUDIO_VARIABLES = [
  'TOKEN_COUNT',
  'WAIT_TIME',
  'NEXT_TIME',
  'DEVICE_NAME',
] as const;

export type AudioVariable = (typeof AUDIO_VARIABLES)[number];

/**
 * 변수를 포함하는 키 → 사용 변수 목록. 여기 없는 키는 정적 클립(단일 mp3).
 * 변수 위치는 언어마다 다르므로 실제 순서는 `AUDIO_SEGMENT_MANIFEST` 가 가진다.
 *
 * 변수 음성인데 값이 안 오면 그 슬롯이 **조용히 묵음**이 되므로 런타임 가드가 이 표를 본다.
 */
export const AUDIO_KEY_VARIABLES = {
  [AUDIO_KEYS.DEMO_DISPENSE_COUNT]: ['TOKEN_COUNT'],
  [AUDIO_KEYS.DEMO_DISPENSE_WAIT]: ['DEVICE_NAME', 'WAIT_TIME'],
  [AUDIO_KEYS.DEMO_NEXT_WINDOW]: ['NEXT_TIME'],
} as const satisfies Partial<Record<AudioKey, readonly AudioVariable[]>>;

/**
 * 변수 → `_var/{슬러그}/{값}` 경로의 타입 슬러그. 모든 동적 값은 통째 클립으로 생성한다
 * (조각을 이어붙이지 않는다 — 억양이 끊긴다). 백엔드 시퀀스 조립의 단일 소스.
 *
 * 여러 변수가 같은 슬러그를 공유할 수 있다 — 발화 형태가 같으면 클립도 공유된다.
 */
export const AUDIO_VAR_TYPES: Partial<Record<AudioVariable, string>> = {
  TOKEN_COUNT: 'count',
  WAIT_TIME: 'duration',
  NEXT_TIME: 'time',
  DEVICE_NAME: 'device',
};

// ── 음성 클립 경로 스키마 — 백엔드 조립 경로의 전체 주소 공간 ──
// 정적·세그먼트 = exact, 변수 값(`_var/{type}/{값}`) 의 값만 동적이라 열린 string.

/** 정적 키 스키마 — `AUDIO_KEYS` 에서 파생(리터럴 선언은 거기 한 곳). */
export const AudioKeySchema = z.enum(
  Object.values(AUDIO_KEYS) as [AudioKey, ...AudioKey[]],
);

/** 변수 키의 세그먼트 경로 `{key}/{i}` — 매니페스트 모든 언어의 합집합. */
export const AudioSegmentPathSchema = z.enum([
  'demo_dispense_count/0',
  'demo_dispense_count/1',
  'demo_dispense_wait/0',
  'demo_dispense_wait/1',
  'demo_next_window/0',
  'demo_next_window/1',
]);
export type AudioSegmentPath = z.infer<typeof AudioSegmentPathSchema>;

/** 동적 값 타입(닫힘). 값(id)은 런타임 데이터라 열려 있다. */
export const AudioVarTypeSchema = z.enum([
  'count',
  'device',
  'duration',
  'time',
]);
export type AudioVarType = z.infer<typeof AudioVarTypeSchema>;

/** 변수 값 경로 `_var/{type}/{값}` — type 닫힘, 값만 열림 (통째 TTS 클립). */
export const AudioVarPathSchema = z.custom<`_var/${AudioVarType}/${string}`>(
  (v) => typeof v === 'string' && /^_var\/[a-z]+\/.+$/.test(v),
);

/** 백엔드 조립 경로의 전체 주소 공간 (정적 ∪ 세그먼트 ∪ 변수값). */
export const AudioClipPathSchema = z.union([
  AudioKeySchema,
  AudioSegmentPathSchema,
  AudioVarPathSchema,
]);
export type AudioClipPath = z.infer<typeof AudioClipPathSchema>;

// ── 세그먼트 매니페스트 + 변수 입력 (백엔드 조립용) ──

/**
 * 매니페스트 토큰 — 정적 조각 인덱스 또는 변수 슬롯.
 * `counter`: 변수에 바인딩된 수사 단위(개·명·호). 한국어는 값+단위를 함께 읽어야 자연스러워
 * (4 → "네 개"), 이 바인딩이 없으면 TTS 가 한자어로만 읽는다. 다른 언어에는 없다.
 */
export type AudioManifestToken =
  | { seg: number }
  | { var: AudioVariable; counter?: string };

/**
 * 변수 → 값. 프론트는 **원어값만** 준다(단위·발음 X). 언어별 발화 변환은 백엔드가 한다 —
 * 같은 값이 언어마다 다르게 읽히는데 그 지식이 화면에 흩어지면 언어를 늘릴 때마다 샌다.
 */
export const AudioVarsSchema = z.object({
  /** 방출할 토큰 개수. ko 는 `counter` 바인딩으로 "세 개"처럼 읽는다. */
  TOKEN_COUNT: z.number().optional(),
  /** 예상 대기(분) → `formatDuration`. */
  WAIT_TIME: z.number().optional(),
  /** 다음 이용 가능 시각(Unix ms) → `formatClockTime`. TZ 는 런타임 로컬. */
  NEXT_TIME: z.number().optional(),
  /** 장치 표시명 — 변환 없이 원어 그대로 읽는다. */
  DEVICE_NAME: z.string().optional(),
});
export type AudioVars = z.infer<typeof AudioVarsSchema>;

/**
 * 변수 키 → 언어별 토큰 순서. 백엔드가 이 시퀀스로 클립을 조립한다.
 * 정적 키는 여기 없다 → 단일 클립 `{lang}/{key}.mp3`.
 *
 * **언어마다 순서가 다른 것이 이 표가 존재하는 이유다.** ko 는 수식이 앞에 붙고 en 은
 * 뒤에 붙는다. 문장을 문자열로 조립했다면 언어를 늘릴 때마다 분기가 생겼을 자리다.
 *
 * zh · zh-Hant-TW 는 데모에서 정적 키만 쓴다(빈 표 = 전부 단일 클립).
 */
export const AUDIO_SEGMENT_MANIFEST: Record<
  TolgeeLanguage,
  Partial<Record<AudioKey, AudioManifestToken[]>>
> = {
  'ko-KR': {
    // "토큰 {N개} 를 방출합니다"
    demo_dispense_count: [
      { seg: 0 },
      { var: 'TOKEN_COUNT', counter: '개' },
      { seg: 1 },
    ],
    // "{장치} 가 준비 중입니다. 약 {대기} 남았습니다"
    demo_dispense_wait: [
      { var: 'DEVICE_NAME' },
      { seg: 0 },
      { var: 'WAIT_TIME' },
      { seg: 1 },
    ],
    // "다음 이용은 {시각} 부터 가능합니다"
    demo_next_window: [{ seg: 0 }, { var: 'NEXT_TIME' }, { seg: 1 }],
  },
  'en-US': {
    demo_dispense_count: [{ seg: 0 }, { var: 'TOKEN_COUNT' }, { seg: 1 }],
    // ko 와 토큰 순서가 다르다 — 장치명이 뒤로 간다.
    demo_dispense_wait: [
      { seg: 0 },
      { var: 'DEVICE_NAME' },
      { seg: 1 },
      { var: 'WAIT_TIME' },
    ],
    demo_next_window: [{ seg: 0 }, { var: 'NEXT_TIME' }],
  },
  'ja-JP': {
    demo_dispense_count: [{ var: 'TOKEN_COUNT' }, { seg: 0 }],
    demo_dispense_wait: [
      { var: 'DEVICE_NAME' },
      { seg: 0 },
      { var: 'WAIT_TIME' },
      { seg: 1 },
    ],
    demo_next_window: [{ var: 'NEXT_TIME' }, { seg: 0 }],
  },
  zh: {},
  'zh-Hant-TW': {},
};
