import {
  AUDIO_SEGMENT_MANIFEST,
  AUDIO_VAR_TYPES,
  type AudioClipPath,
  AudioClipPathSchema,
  type AudioKey,
  type AudioManifestToken,
  type AudioVariable,
  type AudioVars,
  formatClockTime,
  formatDuration,
  readNumberWithCounter,
  type TolgeeLanguage,
} from 'kiosk-types';

/**
 * 변수 음성 시퀀스 조립 — (lang, key, vars) → 재생할 클립/포즈 순서 (순수, I/O 없음).
 *
 * 변수가 없는 키는 단일 정적 클립, 변수 키는 세그먼트 매니페스트를 토큰 순서대로 펼친다:
 *  - **세그먼트** `{seg:i}` → `{key}/{i}` 정적 조각
 *  - **변수 슬롯** → `_var/{슬러그}/{값}` 통째 클립 하나 (값은 변환 전 원어)
 *  - **값 누락 / 슬러그 없는 변수** → `pause`
 *
 * 경로는 `AudioClipPathSchema.parse` 로 만들어 캐스팅 없이 타입을 확정하고, 매니페스트↔경로
 * 스키마 drift(없는 세그먼트 인덱스 등)도 즉시 드러낸다.
 */

/** 조립 결과 항목 — 재생할 클립, 또는 (값 없음/슬러그 없음) 자리의 짧은 무음. */
export type SequenceItem =
  | { kind: 'clip'; path: AudioClipPath }
  | { kind: 'pause'; ms: number };

/** 매니페스트 형태(주입 가능) — 언어 → 키 → 토큰 순서. 기본값은 선언된 상수. */
export type AudioSegmentManifest = Record<
  string,
  Partial<Record<string, AudioManifestToken[]>>
>;

/** 재생용으로 펼친 클립 — mp3 바이트 + 선행 대기(ms). */
export type ResolvedClip = { data: Uint8Array; delay?: number };

/** 변수 값이 없거나 슬러그가 없는 슬롯, 또는 아직 못 받은 바이트를 대체하는 무음 길이. */
const MISSING_VAR_PAUSE_MS = 400;

const pause = (): SequenceItem => ({ kind: 'pause', ms: MISSING_VAR_PAUSE_MS });
const clip = (path: string): SequenceItem => ({
  kind: 'clip',
  path: AudioClipPathSchema.parse(path),
});

/**
 * 변수 슬롯 → `_var/{슬러그}/{발화텍스트}` 클립 하나. 값은 URL-safe 인코딩.
 * 슬러그가 없거나 값이 비면 pause. 발화 텍스트가 곧 클립 키이자 TTS 생성 텍스트다.
 */
function renderVar(
  lang: TolgeeLanguage,
  variable: AudioVariable,
  value: string | number | undefined,
  counter: string | undefined,
): SequenceItem {
  const slug = AUDIO_VAR_TYPES[variable];
  if (!slug || value === undefined || value === '') return pause();
  const spoken = speakVar(lang, slug, value, counter);
  return clip(`_var/${slug}/${encodeURIComponent(spoken)}`);
}

/**
 * 변수 값 → 언어별 발화 문자열. 언어별 포맷을 파이프라인이 소유한다(프론트는 원시값만 넘긴다):
 *  - `time`(Unix ms) → `formatClockTime` · `duration`(분) → `formatDuration` — 전 언어
 *  - ko + counter 바인딩 → `readNumberWithCounter` (세 개 / 네 명)
 *  - 그 외·비-ko → 원어값 그대로 (TTS 가 숫자는 정규화해 읽는다)
 *
 * time 은 TZ 를 안 넘긴다 — 런타임 로컬(=키오스크 현지)로 읽는다.
 */
function speakVar(
  lang: TolgeeLanguage,
  slug: string,
  value: string | number,
  counter: string | undefined,
): string {
  if (slug === 'time') return formatClockTime(Number(value), lang);
  if (slug === 'duration') return formatDuration(Number(value), lang);
  if (lang === 'ko-KR' && counter !== undefined) {
    return readNumberWithCounter(value, counter);
  }
  return String(value);
}

export function buildAudioSequence(
  lang: TolgeeLanguage,
  key: AudioKey,
  vars: AudioVars,
  manifest: AudioSegmentManifest = AUDIO_SEGMENT_MANIFEST,
): SequenceItem[] {
  const tokens = manifest[lang]?.[key];
  // 매니페스트에 없으면 정적(변수 없음) 키 → 단일 클립. (AudioKey ⊂ AudioClipPath)
  if (!tokens) return [{ kind: 'clip', path: key }];

  return tokens.map((token) =>
    'seg' in token
      ? clip(`${key}/${token.seg}`)
      : renderVar(lang, token.var, vars[token.var], token.counter),
  );
}

/**
 * 조립된 SequenceItem 들을 재생용 클립으로 접는다 — pause(및 바이트 없는 클립)의 무음을
 * **다음 클립의 선행 delay** 로 합쳐 `AudioPlayer.play([{url, delay}])` 형태에 맞춘다.
 * `bytesFor` 가 `undefined` 면(아직 생성 안 된 `_var` 등) 그 자리를 pause 로 접어 재생을 잇는다.
 */
export function foldToClips(
  items: SequenceItem[],
  bytesFor: (path: AudioClipPath) => Uint8Array | undefined,
): ResolvedClip[] {
  const clips: ResolvedClip[] = [];
  let pendingDelay = 0;

  for (const item of items) {
    if (item.kind === 'pause') {
      pendingDelay += item.ms;
      continue;
    }
    const data = bytesFor(item.path);
    if (data === undefined) {
      pendingDelay += MISSING_VAR_PAUSE_MS;
      continue;
    }
    clips.push(pendingDelay > 0 ? { data, delay: pendingDelay } : { data });
    pendingDelay = 0;
  }

  return clips;
}
