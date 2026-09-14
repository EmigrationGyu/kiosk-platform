import type { Result, ResultVoid } from 'kiosk-types';
import { ERROR_CODE } from '../constant/ErrorCodes';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { LogService } from '../service/LogService';
import type { SocketHandler } from '../types/Socket';

const logger = LogService.getInstance();

/**
 * 에러에서 원인(cause) 문자열을 추출한다.
 *
 * 하드웨어 트랜스포트 에러는 `{ cause, code }` 형태로 던져지므로 `cause` 를 우선 사용하고,
 * 일반 `Error` 는 `message` 를, 그 외에는 `'Unknown error'` 를 반환한다.
 */
export const extractCause = (error: unknown): string => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof (error as Record<string, unknown>).cause === 'string'
  ) {
    return (error as { cause: string }).cause;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
};

/**
 * 핸들러를 감싸 예기치 못한 예외를 시스템 에러(500)로 변환한다.
 *
 * 디바이스 cause 를 비즈니스 결과로 흘려보내지 않는 cause-agnostic 한 이벤트용. 알려진 디바이스 cause 를
 * 결과값(`res.ok({ success:false })`)으로 변환하려면 {@link withHardwareErrorHandler} 를 쓴다.
 */
export const withErrorHandler = <TReq = unknown, TRes = unknown>(
  handler: SocketHandler<TReq, TRes>,
  context = 'Internal server error',
): SocketHandler<TReq, TRes> => {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      const cause = extractCause(error);
      // 가드(`logger.error`)가 아니라 와이어 API 를 쓴다 — `context` 는 호출부가 박아 넣은
      // 상수지만 파라미터를 거치며 `string` 으로 넓어져, 가드가 동적 데이터로 보고 막는다.
      // 인프라가 호출부의 상수를 그대로 전달하는 자리라 여기서는 하위 API 가 맞다.
      logger.writeError({
        level: 'error',
        msg: context,
        err: logger.toErrFields(error),
        meta: { cause },
      });
      return res.error(ERROR_CODE.INTERNAL_SERVER_ERROR, cause);
    }
  };
};

/**
 * 하드웨어 핸들러용 Railway 래퍼.
 *
 * 던져진 에러의 cause 가 `errorCodeMap` 에 있는 **알려진 디바이스 에러**면 비즈니스 실패로 간주해
 * `res.ok({ success:false, cause, code })` 로 흘려보내고, 그 외 예기치 못한 예외만 시스템 에러(500)로 보낸다.
 *
 * 응답 타입이 실패를 표현할 수 있는 Railway 형태(`Result`/`ResultVoid`)인 이벤트에만 붙일 수 있다 —
 * `void` 처럼 실패를 담을 수 없는 응답에 붙이면 컴파일 에러가 난다.
 */
export const withHardwareErrorHandler = <
  TReq,
  TCause extends string,
  TRes extends ResultVoid<TCause> | Result<unknown, TCause>,
>(
  errorCodeMap: Record<TCause, number>,
  handler: SocketHandler<TReq, TRes>,
  context = 'Hardware error',
): SocketHandler<TReq, TRes> => {
  const knownCauses = new Set<string>(Object.keys(errorCodeMap));
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      const cause = extractCause(error);
      if (knownCauses.has(cause)) {
        logger.writeLog({ level: 'error', msg: context, meta: { cause } });
        return res.ok(SUCCESS_CODE.OK, {
          success: false,
          cause,
          code: errorCodeMap[cause as TCause],
        } as TRes);
      }
      logger.writeError({
        level: 'error',
        msg: `${context} (예기치 못한 오류)`,
        err: logger.toErrFields(error),
        meta: { cause },
      });
      return res.error(ERROR_CODE.INTERNAL_SERVER_ERROR, cause);
    }
  };
};
