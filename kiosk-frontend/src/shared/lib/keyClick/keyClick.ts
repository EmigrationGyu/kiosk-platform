/**
 * 온스크린 키보드 타건음 — Web Audio 로 합성한다(음원 파일 없음).
 *
 * 알림음(`beepLoop`)과 배관은 같지만 음원이 다르다. 알림음은 음정이 있어 사인 부분음을
 * 쌓았지만, 타건음은 음정이 없는 트랜지언트다. 사인만으로 만들면 아무리 짧게 줄여도
 * "딸깍"이 아니라 "삑"이 된다. 그래서 노이즈 버스트가 본체이고 사인은 두께만 얹는다.
 *
 * 안내 음성과 채널을 나눌 필요는 없다 — 20ms 짜리 일회성 발사라 겹쳐 나가면 그만이다.
 */

import { getAudioContext } from '@/shared/lib/audio/context';

export const KEY_CLICK_VARIANTS = {
  KEY: 'key',
  MODIFIER: 'modifier',
  DELETE: 'delete',
  RETURN: 'return',
} as const;

export type KeyClickVariant =
  (typeof KEY_CLICK_VARIANTS)[keyof typeof KEY_CLICK_VARIANTS];

// ── 튜닝 상수 ────────────────────────────────────────────────
// 알림음과 달리 이 값들은 실측이 아니라 설계값이다. 클릭은 정상상태 부분음이 없어
// FFT 로 주파수를 뽑아낼 수가 없다(창 길이만 바꿔도 결과가 달라진다). 귀로 맞출 것.

/**
 * `ringHz` 가 성격을 거의 다 정한다 — 3kHz 아래로 내리면 "툭", 5kHz 위로 올리면
 * "틱" 하는 전자음 쪽으로 급격히 이동한다.
 */
const VARIANT_TUNING: Record<
  KeyClickVariant,
  { ringHz: number; bodyHz: number; level: number }
> = {
  [KEY_CLICK_VARIANTS.KEY]: { ringHz: 3800, bodyHz: 420, level: 1 },
  [KEY_CLICK_VARIANTS.MODIFIER]: { ringHz: 3000, bodyHz: 340, level: 0.8 },
  [KEY_CLICK_VARIANTS.DELETE]: { ringHz: 2700, bodyHz: 300, level: 0.9 },
  [KEY_CLICK_VARIANTS.RETURN]: { ringHz: 4400, bodyHz: 500, level: 1 },
};

const KEY_CLICK_VOLUME = 1;

/** 레이어 배분. 합이 1 이라 겹쳐도 {@link KEY_CLICK_VOLUME} 을 넘지 않는다. */
const EDGE_MIX = 0.35;
const RING_MIX = 0.5;
const BODY_MIX = 1 - EDGE_MIX - RING_MIX;

/** 알림음(20ms)을 그대로 쓰면 "붕"이 된다. 0 으로 두면 DC 팝이 섞이므로 최소만 남긴다. */
const ATTACK_MS = 0.8;

const EDGE_HIGHPASS_HZ = 2200;
/** 늘리면 "치익"이 된다. */
const EDGE_DECAY_MS = 6;

/** 딸깍의 체감 길이는 사실상 이 값이다. */
const RING_DECAY_MS = 14;
/** 높을수록 좁아져 "깡" 하고 울리고, 낮으면 "샤" 하는 잡음이 된다. */
const RING_Q = 3;

/** 길면 그 즉시 "퍽" 으로 되돌아간다. */
const BODY_DECAY_MS = 20;
const BODY_PITCH_DROP = 0.6;

/**
 * 프레스마다 주파수를 흔드는 폭. 0 이면 매번 같은 소리가 나고, 그 순간 귀가 "기계음"
 * 으로 분류해 급격히 거슬려진다. 이 파일에서 체감이 가장 큰 값.
 */
const CLICK_JITTER = 0.08;

/** 지수 감쇠는 0 에 닿지 못하므로 이 비율까지 내려가면 끝난 것으로 본다. */
const DECAY_FLOOR = 0.001;
const NOISE_SECONDS = 0.2;
// ────────────────────────────────────────────────────────────

let noiseBuffer: AudioBuffer | null = null;

const getNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
  if (noiseBuffer) return noiseBuffer;
  const buffer = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * NOISE_SECONDS),
    ctx.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
};

const scheduleEnvelope = (
  ctx: AudioContext,
  peak: number,
  startAt: number,
  decayMs: number,
): { gain: GainNode; endAt: number } => {
  const gain = ctx.createGain();
  const peakAt = startAt + ATTACK_MS / 1000;
  const endAt = peakAt + decayMs / 1000;

  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, peakAt);
  gain.gain.exponentialRampToValueAtTime(peak * DECAY_FLOOR, endAt);

  return { gain, endAt };
};

/** 노드는 끝나면 스스로 정리되므로 중단 핸들은 없다 — 화면이 걷혀도 남아 울릴 길이가 아니다. */
export const playKeyClick = (
  variant: KeyClickVariant = KEY_CLICK_VARIANTS.KEY,
): void => {
  const ctx = getAudioContext();
  // 사용자 제스처 전에 만들어졌으면 suspended 다. 키보드가 떴다는 건 손님이 이미
  // 입력창을 눌렀다는 뜻이라 재개가 허용된다.
  void ctx.resume();

  const { ringHz, bodyHz, level } = VARIANT_TUNING[variant];
  const startAt = ctx.currentTime;
  const jitter = 1 + (Math.random() - 0.5) * CLICK_JITTER;
  const gainOf = (mix: number) => KEY_CLICK_VOLUME * level * mix;

  // EDGE·RING 은 한 번의 충격이어야 하므로 노이즈 소스를 공유한다. 난수를 따로 뽑으면
  // 두 소리가 겹친 것처럼 들린다. 읽기 시작점은 매번 다르게 — 같은 잡음 패턴이 반복되면
  // 주파수를 흔들어도 티가 난다.
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  noise.start(startAt, Math.random() * (NOISE_SECONDS / 2));

  // EDGE — 저역을 통째로 버린 충격. 딸깍의 "딸".
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(EDGE_HIGHPASS_HZ, startAt);
  const edge = scheduleEnvelope(ctx, gainOf(EDGE_MIX), startAt, EDGE_DECAY_MS);
  noise.connect(highpass).connect(edge.gain).connect(ctx.destination);

  // RING — 좁은 밴드패스로 입힌 색. 딸깍의 "깍".
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(ringHz * jitter, startAt);
  bandpass.Q.setValueAtTime(RING_Q, startAt);
  const ring = scheduleEnvelope(ctx, gainOf(RING_MIX), startAt, RING_DECAY_MS);
  noise.connect(bandpass).connect(ring.gain).connect(ctx.destination);

  noise.stop(Math.max(edge.endAt, ring.endAt));

  // BODY — 두께만 얹는다. 비중이 커지면 그대로 "퍽" 이 된다.
  const body = ctx.createOscillator();
  const bodyEnv = scheduleEnvelope(
    ctx,
    gainOf(BODY_MIX),
    startAt,
    BODY_DECAY_MS,
  );
  body.type = 'sine';
  body.frequency.setValueAtTime(bodyHz * jitter, startAt);
  body.frequency.exponentialRampToValueAtTime(
    bodyHz * jitter * BODY_PITCH_DROP,
    bodyEnv.endAt,
  );
  body.connect(bodyEnv.gain).connect(ctx.destination);
  body.start(startAt);
  body.stop(bodyEnv.endAt);
};
