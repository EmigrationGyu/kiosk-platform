import dayjs, { type Dayjs } from 'dayjs';
import { Logger } from '../logger/Logger';

/**
 * 서버 `Date`/`DateTime` 스칼라 → dayjs.
 *
 * codegen 은 두 스칼라를 `string` 하나로 뭉개지만 실제 wire 는 두 갈래다 — `Reservation.intendedUse*`
 * 는 unix ms 문자열, `EphemeralOccupation.use*` 는 ISO. 타입이 못 가르므로 값이 가르고, 이 파일이 그
 * 판별의 유일한 자리다.
 *
 * 받아들이는 형태는 **닫힌 집합**이고 나머지는 전부 신뢰 불가로 떨어진다 — 추측을 시작하면
 * `20260511`(unix ms 면 1970, YYYYMMDD 면 2026) 같은 값에서 선을 그을 근거가 사라진다. 오프셋 없는
 * ISO 만 예외적으로 **가정**을 허용한다(거절하면 서버가 오프셋을 빼는 순간 필드가 화면에서 통째로
 * 사라지는데, 여긴 근거 있는 기본값 KST 가 있다). 대신 가정한 사실을 태그로 남긴다.
 */

export const WIRE_INSTANT_FORM = {
  /** unix 밀리초 (숫자). */
  EPOCH_MS_NUMBER: 'epoch-ms-number',
  /** unix 밀리초 (숫자 문자열) — `Reservation.intendedUse*`. */
  EPOCH_MS_STRING: 'epoch-ms-string',
  /** ISO 8601 + 명시적 오프셋 — `EphemeralOccupation.use*`. */
  ISO_OFFSET: 'iso-offset',
  /** 오프셋 없는 ISO. KST 로 **가정**해 읽는다 — 아래 주석 참고. */
  ISO_ASSUMED_KST: 'iso-assumed-kst',
} as const;

export type WireInstantForm =
  (typeof WIRE_INSTANT_FORM)[keyof typeof WIRE_INSTANT_FORM];

export const WIRE_INSTANT_REJECT = {
  /** 값이 없음. nullable 필드가 비어 온 정상 케이스라 신뢰 실패와 구분한다. */
  EMPTY: 'empty',
  /** 셋 중 어느 형태도 아님 — 오프셋 없는 ISO, 날짜만, `'Invalid Date'` 등. */
  NOT_RECOGNIZED: 'not-recognized',
  /** 형태는 맞으나 타당성 창 밖 — 초 단위 epoch 를 잡는 자리. */
  OUT_OF_WINDOW: 'out-of-window',
} as const;

export type WireInstantReject =
  (typeof WIRE_INSTANT_REJECT)[keyof typeof WIRE_INSTANT_REJECT];

/**
 * 파서가 `null` 을 낸 자리의 표시 기본값. 예전엔 `dayjs(null).format()` 이 `'Invalid Date'` 를 그대로
 * 화면에 찍었다 — 값이 없다는 사실은 보여주되 개발자 문자열을 손님에게 노출하지 않는다.
 */
export const UNREADABLE_TIME_TEXT = '—';

export type WireInstantRecognition =
  | { ok: true; at: Dayjs; form: WireInstantForm }
  | { ok: false; reason: WireInstantReject };

/**
 * 예약 도메인의 일시가 놓일 수 있는 범위.
 *
 * 이 창이 이 파서의 실질적 보증이다 — 초/밀리초 혼동(`1754899200` → 1970-01-21)은
 * 숫자로는 멀쩡히 파싱되고 오직 여기서만 죽는다.
 */
const PLAUSIBLE_FROM_MS = Date.UTC(2000, 0, 1);
const PLAUSIBLE_TO_MS = Date.UTC(2100, 0, 1);

const ISO_BODY = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?`;

const ISO_WITH_OFFSET = new RegExp(`^${ISO_BODY}(?:Z|[+-]\\d{2}:\\d{2})$`);

/**
 * 오프셋이 빠진 ISO.
 *
 * 그냥 `dayjs(raw)` 로 넘기면 **JS 가 런타임 로컬 TZ 로 해석**해서 키오스크(KST)와
 * CI(UTC)가 9시간 갈린다 — `wire-datetime.ts` 가 `toISOString()` 을 쓰지 않는 것과
 * 같은 이유다. 그래서 받되 `+09:00` 을 명시적으로 박아 해석을 고정한다.
 *
 * 이건 검증이 아니라 **가정**이다(서버가 UTC 를 의도했다면 9시간 틀린다). 가정인 걸
 * 숨기지 않으려고 `ISO_ASSUMED_KST` 로 따로 태깅한다 — 로그에서 형태 전환이 보인다.
 */
const ISO_NO_OFFSET = new RegExp(`^${ISO_BODY}$`);

const ASSUMED_OFFSET = '+09:00';

const NUMERIC = /^-?\d+$/;

const asEpochMs = (value: string | number): number | null => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  return NUMERIC.test(value) ? Number(value) : null;
};

const isPlausible = (ms: number): boolean =>
  ms >= PLAUSIBLE_FROM_MS && ms < PLAUSIBLE_TO_MS;

/** ISO 두 갈래를 하나의 "오프셋이 박힌 문자열"로 모은다. */
const asIso = (
  text: string,
): { text: string; form: WireInstantForm } | null => {
  if (ISO_WITH_OFFSET.test(text))
    return { text, form: WIRE_INSTANT_FORM.ISO_OFFSET };
  if (ISO_NO_OFFSET.test(text))
    return {
      text: `${text}${ASSUMED_OFFSET}`,
      form: WIRE_INSTANT_FORM.ISO_ASSUMED_KST,
    };
  return null;
};

/**
 * 판별 결과를 사유까지 붙여 돌려준다. 사유가 이름을 갖는 이유는 로그에서 **서버 포맷
 * 변경을 감지**하기 위해서다 — "못 읽었다"가 아니라 "숫자인데 창 밖이다"가 찍혀야 한다.
 */
export const recognizeWireInstant = (
  value: string | number | null | undefined,
): WireInstantRecognition => {
  if (value === null || value === undefined)
    return { ok: false, reason: WIRE_INSTANT_REJECT.EMPTY };

  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return { ok: false, reason: WIRE_INSTANT_REJECT.EMPTY };

  const epochMs = asEpochMs(raw);
  if (epochMs !== null) {
    if (!isPlausible(epochMs))
      return { ok: false, reason: WIRE_INSTANT_REJECT.OUT_OF_WINDOW };
    return {
      ok: true,
      at: dayjs(epochMs),
      form:
        typeof raw === 'number'
          ? WIRE_INSTANT_FORM.EPOCH_MS_NUMBER
          : WIRE_INSTANT_FORM.EPOCH_MS_STRING,
    };
  }

  const iso = typeof raw === 'string' ? asIso(raw) : null;
  if (iso) {
    const at = dayjs(iso.text);
    // 형태만 맞고 값이 없는 날짜(2026-13-45)는 여기서 걸린다.
    if (!at.isValid())
      return { ok: false, reason: WIRE_INSTANT_REJECT.NOT_RECOGNIZED };
    if (!isPlausible(at.valueOf()))
      return { ok: false, reason: WIRE_INSTANT_REJECT.OUT_OF_WINDOW };
    return { ok: true, at, form: iso.form };
  }

  return { ok: false, reason: WIRE_INSTANT_REJECT.NOT_RECOGNIZED };
};

/**
 * 로그로 올릴 거절인가.
 *
 * `EMPTY` 는 nullable 필드가 비어 온 것뿐이라 신뢰 실패가 아니다 — 이걸 로그로 올리면
 * 선택 필드마다 소음이 나서 진짜 실패(포맷 변경)가 묻힌다. 정책이 조건문에 묻히지
 * 않도록 이름을 붙여 뽑아 둔다.
 */
export const isTrustFailure = (reason: WireInstantReject): boolean =>
  reason !== WIRE_INSTANT_REJECT.EMPTY;

/** 거절 로그 문구. 어느 필드가 어떤 사유로 떨어졌는지가 이 문자열의 전부다. */
export const wireInstantRejectMessage = (
  label: string,
  reason: WireInstantReject,
  raw: string | number | null | undefined,
): string =>
  `[wire-instant] ${label} 신뢰 불가 — reason=${reason} raw=${String(raw)}`;

const logger = new Logger();

/**
 * 소비처용 API — 신뢰할 수 있으면 `Dayjs`, 아니면 `null`.
 *
 * 여기서 throw 하지 않는 이유: 읽기 경계에서 던지면 게스트 앞에서 화면이 죽는다.
 * 대신 로그로 시끄럽게 남긴다. **서버로 되싣는 쓰기 경계는 반대로 던져야** 한다 —
 * 신뢰 불가 값이 예약 페이로드로 나가면 되돌릴 수 없다.
 *
 * @param label 실패 로그에 찍을 필드 이름. 어느 필드가 깨졌는지 모르면 로그가 무용하다.
 */
export const parseWireInstant = (
  value: string | number | null | undefined,
  label = 'unknown',
): Dayjs | null => {
  const result = recognizeWireInstant(value);
  if (result.ok) return result.at;

  if (isTrustFailure(result.reason)) {
    logger.error(wireInstantRejectMessage(label, result.reason, value));
  }
  return null;
};
