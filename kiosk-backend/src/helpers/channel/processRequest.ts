import { contractMismatchCause, updatePendingCause } from 'kiosk-types';
import type { z } from 'zod';
import { fromError } from 'zod-validation-error';
import { ERROR_CODE } from '../../constant/ErrorCodes';
import type { SocketHandler, SocketRequest } from '../../types/Socket';
import { updateGate } from '../../update/updateGate';

/** 채널 구현(socket/ipc)이 요청자에게 돌려보내는 와이어 응답 봉투 */
export type WireResponse =
  | { result: unknown; id: string | undefined; code: number; ok: true }
  | { cause: string; id: string | undefined; code: number; ok: false };

/**
 * 채널 공통 요청 처리 파이프라인: Zod 검증 → 핸들러 실행 → 응답 봉투.
 *
 * socket(dev)/ipc(electron) 두 채널 구현의 유일한 차이는 봉투를 "어떻게
 * 돌려보내는가"(emit vs handle 반환)뿐이어야 한다 — 검증·실행 로직이 갈라지며
 * 생겼던 버그(검증 실패 응답 유실/브로드캐스트)의 재발을 여기서 막는다.
 *
 * 핸들러에는 원본 body 가 아니라 **parseAsync 결과**를 전달한다. 스키마의
 * strip(미선언 키 제거)·default·transform 이 실제로 적용되게 하기 위함이다.
 */
export async function processRequest(
  event: string,
  request: SocketRequest<unknown>,
  schema: z.ZodType | undefined,
  handler: SocketHandler<any, any> | undefined,
): Promise<WireResponse> {
  try {
    const { id, body } = request;

    // 교체가 확정된 뒤에는 아무것도 시작하지 않는다. 실행 **전에** 거절하므로 "확실히
    // 아무 일도 없었다"가 보장되고, 소비처는 조용히 재시도하면 된다.
    if (updateGate.isLocked()) {
      return {
        id,
        code: ERROR_CODE.SERVICE_UNAVAILABLE,
        ok: false,
        cause: updatePendingCause('업데이트 적용 준비 중입니다'),
      };
    }

    // 스키마·핸들러 부재는 "이 백엔드가 그 이벤트를 모른다"는 뜻이다. 일반 500 으로
    // 뭉개면 상대가 터진 것인지 계약이 갈린 것인지 구별할 수 없어, 전용 cause 로 올린다.
    if (!schema || !handler) {
      return {
        id: request?.id,
        code: ERROR_CODE.NOT_IMPLEMENTED,
        ok: false,
        cause: contractMismatchCause(`백엔드가 모르는 이벤트입니다: ${event}`),
      };
    }

    let parsedBody: unknown;
    try {
      parsedBody = await schema.parseAsync(body);
    } catch (e) {
      const validationError = fromError(e);
      return {
        id,
        code: ERROR_CODE.BAD_REQUEST,
        ok: false,
        cause: validationError.toString(),
      };
    }

    // 런타임 구현은 느슨하게 두되, 핸들러 쪽 제네릭 강제를 방해하지 않도록 any
    const responseForEvent: any = {
      ok: (code: number, data: any) => ({ success: true, code, data }),
      error: (code: number, cause: string) => ({
        success: false,
        code,
        cause,
      }),
    };

    const result = await handler(parsedBody, responseForEvent);

    if (result.success) {
      return { result: result.data, id, code: result.code, ok: true };
    }
    return { cause: result.cause, id, code: result.code, ok: false };
  } catch (_err) {
    return {
      id: (request && request.id) || undefined,
      code: 500,
      ok: false,
      cause: 'Internal Server Error',
    };
  }
}
