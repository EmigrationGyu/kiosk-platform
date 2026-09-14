import { Logger } from '@/shared/Logger';
import type { Handler } from './types';

/**
 * 에러에서 원인(cause) 문자열을 추출한다.
 *
 * IPC/하드웨어 에러는 `{ cause }` 형태로 던져질 수 있으므로 `cause` 를 우선 사용하고,
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
 * 시리얼포트 컨트롤러 핸들러를 감싸 예기치 못한 예외를 에러 응답으로 변환한다. 던져진 예외를 잡아
 * 원인을 로깅하고 `res.error(code, cause)` 로 응답하며, 정상 반환은 그대로 통과시킨다.
 *
 * Router 의 최상위 catch 는 cause 를 `'Internal Server Error'` 로 뭉개지만 이 래퍼는 {@link extractCause}
 * 로 실제 원인을 보존해 백엔드 Transport 까지 전달한다. 알려진 디바이스 결과를 비즈니스 응답으로
 * 매핑하는 책임은 각 서비스가 이미 `Result` 반환으로 처리하므로(backend 의 `withHardwareErrorHandler`
 * 와 달리) 컨트롤러 레벨에서는 이 래퍼 하나면 충분하다.
 *
 * @param code 예외 시 응답 코드 (기본 500; 헬스체크 등 가용성 실패는 503)
 */
export const withErrorHandler = <TReq = unknown, TRes = unknown>(
  handler: Handler<TReq, TRes>,
  context = 'Internal server error',
  code = 500,
): Handler<TReq, TRes> => {
  return async (body, res) => {
    try {
      return await handler(body, res);
    } catch (error) {
      const cause = extractCause(error);
      Logger.getInstance().error('[IPC] 핸들러 실패', error, {
        context,
        cause,
      });
      return res.error(code, cause);
    }
  };
};
