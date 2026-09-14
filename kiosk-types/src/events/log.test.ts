import { describe, expect, test } from 'bun:test';
import { LOG_EVENTS, LogSchemas } from './log';

const LogReq = LogSchemas[LOG_EVENTS.LOG];
const ErrReq = LogSchemas[LOG_EVENTS.ERROR];

/**
 * log 스키마의 비자명 부분만 검증: LogRequest 의 .refine(msg||meta) 규칙과
 * level default. Zod 원시 동작이 아니라 우리가 쓴 분기 로직이라 회귀 가치가 있다.
 */
describe('LogRequestSchema — msg 또는 meta 필수 (.refine)', () => {
  test('msg 만 있어도 통과', () => {
    expect(LogReq.safeParse({ msg: 'hello' }).success).toBe(true);
  });

  test('meta 만 있어도 통과', () => {
    expect(LogReq.safeParse({ meta: { a: 1 } }).success).toBe(true);
  });

  test('msg/meta 둘 다 없으면 거절 (우리 규칙)', () => {
    expect(LogReq.safeParse({}).success).toBe(false);
    expect(LogReq.safeParse({ tags: ['x'] }).success).toBe(false);
  });

  test('level 생략 시 info default 채워짐', () => {
    const r = LogReq.parse({ msg: 'x' });
    expect(r.level).toBe('info');
  });
});

describe('ErrorLogRequestSchema — err 필수 + level error default', () => {
  test('err.message 있으면 통과, level=error 로 채워짐', () => {
    const r = ErrReq.parse({ err: { message: 'boom' } });
    expect(r.level).toBe('error');
  });

  test('err 누락 거절', () => {
    expect(ErrReq.safeParse({ msg: 'x' }).success).toBe(false);
  });

  test('err.message 누락 거절 (ErrorLike.message 필수)', () => {
    expect(ErrReq.safeParse({ err: {} }).success).toBe(false);
  });

  test('error 로그는 msg/meta refine 적용 안 됨 (err 만으로 충분)', () => {
    // ErrorLogRequestSchema 는 BaseLog.extend 라 LogRequestSchema 의 refine 비적용.
    expect(ErrReq.safeParse({ err: { message: 'x' } }).success).toBe(true);
  });
});
