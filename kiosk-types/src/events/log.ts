import { z } from 'zod';
import { JsonValue, LOG_LEVELS, LogErrorFieldsSchema } from '../log';

export const LOG_EVENTS = {
  LOG: '/log',
  ERROR: '/error',
} as const;

// 로그 레벨·JSON 값·에러 필드는 src/log.ts 가 단일 출처다 — 소켓 이벤트(여기)와 프로세스
// 사이를 오가는 LogRecord 가 같은 어휘를 써야 렌더러 로그와 자식 로그가 한 파일에서 섞인다.
const LogLevel = z.enum(LOG_LEVELS);

const ErrorLike = LogErrorFieldsSchema;

/**
 * 값이 실리는 자리는 **`meta` 하나뿐이다.**
 *
 * 예전에는 `args`(util.format 보간)·`context`·`tags` 도 있었다. 셋 다 지웠다 —
 * `args` 는 상수 메시지에 값을 끼워넣는 두 번째 통로라 보간 금지 가드를 그대로 우회했고
 * (전 패키지 호출부 0곳), `context`·`tags` 는 pino binding 에만 들어가고
 * `pinoLineToRecord` 가 버려서 **애초에 파일에 도달한 적이 없다.**
 *
 * 키는 `LOG_FIELDS` 로 닫혀 있지만 여기는 와이어라 런타임 검증만 한다 — 타입 강제는
 * 렌더러 `Logger` 시그니처가 지고, 넘어온 미등록 키는 포맷 단계에서 값이 버려진다.
 */
const BaseLog = z.object({
  level: LogLevel.default('info'),
  msg: z.string().optional(),
  meta: z.record(z.string(), JsonValue).optional(),
});

const LogRequestSchema = BaseLog.refine(
  (d) => Boolean(d.msg) || Boolean(d.meta),
  { message: 'msg 또는 meta 중 하나는 필수입니다.' },
);

const ErrorLogRequestSchema = BaseLog.extend({
  level: LogLevel.default('error'),
  err: ErrorLike,
});

export const LogSchemas = {
  [LOG_EVENTS.LOG]: LogRequestSchema,
  [LOG_EVENTS.ERROR]: ErrorLogRequestSchema,
} satisfies Record<keyof LogEventMap, z.ZodType>;

export type LogSuccessResponse = { success: true };
export type LogFailureResponse = {
  success: false;
  code: number;
  cause: string;
};
export type LogResponseBody = LogSuccessResponse | LogFailureResponse;

// ── Response schemas ─────────────────────────────────────────────────────────

const LogResponseBodySchema = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), code: z.number(), cause: z.string() }),
]);

export const LogResponseSchemas = {
  [LOG_EVENTS.LOG]: LogResponseBodySchema,
  [LOG_EVENTS.ERROR]: LogResponseBodySchema,
} satisfies Record<keyof LogEventMap, z.ZodType>;

export type LogEventMap = {
  [LOG_EVENTS.LOG]: {
    request: z.infer<(typeof LogSchemas)[typeof LOG_EVENTS.LOG]>;
    response: LogResponseBody;
  };
  [LOG_EVENTS.ERROR]: {
    request: z.infer<(typeof LogSchemas)[typeof LOG_EVENTS.ERROR]>;
    response: LogResponseBody;
  };
};
