// 서버 zod 스키마(Log.ts)에 대응하는 타입 시스템

// 이벤트 리터럴 타입 (런타임 값은 사용하지 않음)
export type LogEvent = '/log' | '/error';

// JSON 직렬화 가능한 값
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

// pino 레벨
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// Error 객체 유사 타입 (서버 zod ErrorLike에 대응)
export type ErrorLike = {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: Json;
};

// 공통 필드
export type BaseLog = {
  level?: LogLevel; // 기본값 'info' (서버에서 기본값 처리)
  msg?: string;
  meta?: Record<string, Json>;
  context?: Record<string, Json>;
  tags?: string[];
  args?: Json[];
};

// 최소 1개 필수 유틸리티
type RequireAtLeastOne<T, K extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, K>
> &
  {
    [P in K]-?: Required<Pick<T, P>> & Partial<Pick<T, Exclude<K, P>>>;
  }[K];

// 일반 로그 요청: msg 또는 meta 중 최소 하나는 필수
export type LogRequest = RequireAtLeastOne<BaseLog, 'msg' | 'meta'>;

// 에러 로그 요청: err 필수, level은 error/fatal 권장(서버 기본값 'error')
export type ErrorLogRequest = BaseLog & {
  level?: LogLevel;
  err: ErrorLike;
};

// 응답 바디 (서버 ResponseBody와 일치)
export type SuccessResponse = { success: true };
export type FailureResponse = { success: false; code: number; cause: string };
export type ResponseBody = SuccessResponse | FailureResponse;

// 이벤트 맵 (서버 LogEventMap과 동일한 형태)
export type LogEventMap = {
  '/log': {
    req: LogRequest;
    res: ResponseBody;
  };
  '/error': {
    req: ErrorLogRequest;
    res: ResponseBody;
  };
};

// 선택: 서버 zod 의존 없이 응답 타입을 추론할 때 사용할 수 있도록 선언만 유지
// (런타임 검증은 transport 구현에서 처리)
export type InferResponse<T extends keyof LogEventMap> = LogEventMap[T]['res'];
export type InferRequest<T extends keyof LogEventMap> = LogEventMap[T]['req'];
