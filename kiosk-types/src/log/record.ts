import { z } from 'zod';
import {
  SERIALPORT_PROCESS,
  type SerialportProcess,
} from '../serialport/processes';
import { maskLogMeta, UNMASKED_KEY } from './fields';

// JSON 직렬화 가능한 값
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

export const JsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);

/** pino 레벨 — 로그를 내는 모든 프로세스의 공통 어휘. */
export const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * 로그를 낸 프로세스. 로그 파일이 하나로 합쳐지면서 "누가 낸 줄인가"를 파일명 대신 이 필드가 진다.
 * 닫힌 집합이라 새 출처는 여기 추가해야 하고, 그래야 파일에서 사라지지 않는다.
 */
export const LOG_ORIGIN = {
  BACKEND: 'backend',
  RENDERER: 'renderer',
  /** electron 메인 — 자기 파일에 따로 남지만 레코드 형태는 공유한다. */
  MAIN: 'main',
  TEST: 'test',
} as const;

export type LogOrigin =
  | (typeof LOG_ORIGIN)[keyof typeof LOG_ORIGIN]
  | SerialportProcess;

const LogOriginSchema = z.enum([
  ...Object.values(LOG_ORIGIN),
  ...Object.values(SERIALPORT_PROCESS),
] as [LogOrigin, ...LogOrigin[]]);

export const LogErrorFieldsSchema = z.looseObject({
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  cause: JsonValue.optional(),
});

export type LogErrorFields = z.infer<typeof LogErrorFieldsSchema>;

/**
 * 로그 한 건 — 만드는 곳과 파일에 쓰는 곳 사이의 유일한 계약. producer 는 레코드를 만들어 sink 에
 * 넘길 뿐 **누가 읽는지 모르고**, writer 는 받아 쓸 뿐 **어떻게 왔는지 모른다.**
 */
export const LogRecordSchema = z.object({
  origin: LogOriginSchema,
  level: z.enum(LOG_LEVELS),
  /**
   * 로그가 **발생한** 시각 `YYYY-MM-DD HH:mm:ss.SSS`. 반드시 producer 가 찍는다 — writer 가 도착
   * 시각으로 찍으면 파이프를 타고 온 자식 로그가 자기 프로세스 안의 순서를 잃는다.
   */
  time: z.string(),
  msg: z.string().optional(),
  meta: JsonValue.optional(),
  err: LogErrorFieldsSchema.optional(),
});

export type LogRecord = z.infer<typeof LogRecordSchema>;

/** `YYYY-MM-DD HH:mm:ss.SSS` — 레코드 시각의 단일 포맷. */
export const formatLogTime = (d: Date = new Date()): string => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return `${date} ${time}`;
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: '정보',
  debug: '정보',
  info: '정보',
  warn: '경고',
  error: '에러',
  fatal: '에러',
};

/** 인라인으로 붙일 수 있는 값 — 한 줄을 깨지 않는 스칼라. */
const isScalar = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** 공백·`=`·따옴표가 든 문자열은 감싼다 — 안 그러면 `key=value` 경계가 뭉개진다. */
const inlineScalar = (value: unknown): string => {
  if (typeof value !== 'string') return String(value);
  return /[\s="]/.test(value) ? JSON.stringify(value) : value;
};

/**
 * 객체의 항목들. `unmasked` 안쪽은 **같은 높이로 펼친다** — `unmasked={…}` 로 한 겹 더
 * 들어가면 지금 로그(`expected=0x1f candidate=…`)보다 읽기 나빠진다. 배열 원소 안에서도
 * 같은 규칙이라 여기 한 곳에 둔다.
 */
const flatEntries = (obj: object): [string, unknown][] =>
  Object.entries(obj as Record<string, unknown>).flatMap(
    ([key, value]): [string, unknown][] => {
      if (key !== UNMASKED_KEY) return [[key, value]];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [[key, value]];
      }
      return Object.entries(value as Record<string, unknown>);
    },
  );

/** 스칼라만 든 객체 → `{k=v k2=v2}`. 하나라도 더 중첩되면 `null`. */
const inlineFlatObject = (value: unknown): string | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = flatEntries(value);
  if (entries.length === 0 || !entries.every(([, v]) => isScalar(v))) {
    return null;
  }
  return `{${entries.map(([k, v]) => `${k}=${inlineScalar(v)}`).join(' ')}}`;
};

/**
 * 값 하나를 한 줄 표현으로. 스칼라 · 스칼라 배열 · 얕은 객체 · **얕은 객체의 배열**까지 편다.
 *
 * 객체 배열까지 펴는 이유: 경계가 원소별로 가리려면 호출부가 `[{ guestName, score }]` 같은
 * 구조를 넘겨야 하는데(조치 A-10), 그걸 전부 블록으로 내리면 **실패 검색마다 찍히는 최빈
 * 진단 줄이 20줄**이 된다. 한 겹까지만 편다 — 더 깊으면 한 줄에 욱여넣어도 못 읽는다.
 */
const inlineValue = (value: unknown): string | null => {
  if (isScalar(value)) return inlineScalar(value);
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      return `[${value.map(inlineScalar).join(', ')}]`;
    }
    const items = value.map(inlineFlatObject);
    if (items.every((item) => item !== null)) return `[${items.join(', ')}]`;
    return null;
  }
  return inlineFlatObject(value);
};

/**
 * meta 를 `key=value` 로 한 줄에 붙인다. 한 겹까지 펴고, 더 깊으면 `null` 을 돌려 기존
 * 블록으로 떨어뜨린다.
 *
 * 이 인라인이 없으면 값을 meta 로 옮긴 모든 로그가 여러 줄이 된다. 예전 구현은 인라인 분기가
 * 있었지만 `JSON.stringify(x, null, 2)` 가 객체면 언제나 줄바꿈을 넣어 사실상 죽어 있었다.
 */
const formatMetaInline = (meta: unknown): string | null => {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const entries = flatEntries(meta);
  if (entries.length === 0) return null;

  const parts: string[] = [];
  for (const [key, value] of entries) {
    const inline = inlineValue(value);
    if (inline === null) return null;
    parts.push(`${key}=${inline}`);
  }
  return parts.join(' ');
};

/**
 * 파일에 쓰이는 사람이 읽는 한 줄(들). 순수 함수 — fs 를 모른다. 포맷이 여기 하나뿐이라
 * 백엔드·서브프로세스·electron 메인의 줄이 같은 모양으로 남는다. 버전은 레코드가 아니라 **쓰는
 * 쪽**이 안다(부분 업데이트로 컴포넌트 버전이 갈릴 수 있어, 레코드에 실으면 값이 섞인다).
 *
 * **마스킹도 여기서 한다.** 로그 줄이 되는 유일한 통로라, 여기 두면 백엔드를 안 거치는 writer
 * (serialport 파일 sink·electron 메인 로그·독립 실행 서브프로세스)까지 전부 덮인다. 마스킹을
 * 백엔드 경계에만 두면 그 셋이 조용히 빠진다(조치 A-10).
 */
export const formatLogRecord = (
  record: LogRecord,
  opts?: { version?: string },
): string => {
  const parts: string[] = [`[${LEVEL_LABEL[record.level]}]`, record.time];
  if (opts?.version) parts.push(`[버전:${opts.version}]`);
  parts.push(`[${record.origin}]`);

  // 문맥(msg)과 원인(err.message)은 **둘 다 남긴다** — 호출부는 어디서 왜 실패했는지를 msg 에 싣기
  // 때문에 하나를 버리면 진단에 필요한 절반이 파일에 도달하지 못한다. 단 msg 가 이미 원인을 품고
  // 있으면 붙이지 않는다(`withErrorHandler` 는 `${문맥}: ${원인}` 으로 msg 를 만든다).
  const cause = record.err?.message;
  const message =
    record.msg && cause && !record.msg.includes(cause)
      ? `${record.msg} — ${cause}`
      : (record.msg ?? cause);
  if (message) parts.push(`[메세지: ${message}]`);

  const head = parts.join(' ');
  let out = head;
  if (record.meta !== undefined) {
    const masked = maskLogMeta(record.meta);
    const inline = formatMetaInline(masked);
    if (inline !== null) {
      out += ` ${inline}`;
    } else {
      // 객체가 아니거나(스칼라) 중첩이 있는 경우 — 예전 형태 그대로.
      const metaStr = JSON.stringify(masked, null, 2);
      out += metaStr.includes('\n')
        ? `\n데이터: ${metaStr}`
        : ` [데이터: ${metaStr}]`;
    }
  }
  out += '\n';
  if (record.err?.stack) out += `스택: ${record.err.stack}\n`;
  return out;
};

/**
 * 텍스트 스트림(stdout 등)에 로그를 실을 때의 프레이밍. 접두어가 없는 줄은 로그가 아니다 —
 * `[ready]` 처럼 같은 스트림을 쓰는 다른 신호와 섞이지 않게 한다. 양쪽 끝이 같은 규약을 써야
 * 하므로 codec 을 계약과 함께 둔다.
 */
const LOG_LINE_PREFIX = '@log:';

export const encodeLogLine = (record: LogRecord): string =>
  `${LOG_LINE_PREFIX}${JSON.stringify(record)}`;

/** 로그 줄이 아니면 null. 경계에서 파싱하므로 깨진 줄은 raw 로 흘려보낸다. */
export const decodeLogLine = (line: string): LogRecord | null => {
  if (!line.startsWith(LOG_LINE_PREFIX)) return null;
  try {
    const parsed = LogRecordSchema.safeParse(
      JSON.parse(line.slice(LOG_LINE_PREFIX.length)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
