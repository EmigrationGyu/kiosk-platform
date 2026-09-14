import { z } from 'zod';
import type { Result } from '../result';
import { resultSchemaOf } from '../result';
import type { DispenserStatus } from '../serialport/token-dispenser';
import { DispenserStatusSchema } from '../serialport/token-dispenser';
import type { TokenDispenserCause } from '../types/token-dispenser';
import { TOKEN_DISPENSER_ERROR_CODE } from '../types/token-dispenser';

/**
 * 프론트엔드 ↔ 백엔드 토큰 디스펜서 표면.
 *
 * 서브프로세스 계약(`serialport/token-dispenser`)과 **일부러 다르다.** 프론트는 장치의
 * 중간 위치나 급지 모드를 알 필요가 없고, 알게 되면 UI 가 장치 사정에 묶인다. 여기 있는
 * 것은 "무엇을 원하는가"뿐이고 "어떻게"는 백엔드 서비스가 판단한다.
 */
export const TOKEN_DISPENSER_EVENTS = {
  /** 토큰 n 개를 손님이 가져갈 수 있는 위치까지 내보낸다. */
  DISPENSE: '/dispense',
  /** 게이트에 남은 토큰을 반환함으로 회수한다(손님이 안 가져간 경우). */
  RETURN: '/return',
  /** 현재 장치 상태. 관리자 화면·기기점검용. */
  STATUS: '/status',
  RESET: '/reset',
} as const;

const DispenseRequestSchema = z.object({
  /** 발급 매수. 상한은 1회 트랜잭션에서 현실적으로 필요한 범위로 묶는다. */
  count: z.number().int().min(1).max(10),
});

const DispenseResultSchema = z.object({
  dispensed: z.number().int().min(0),
  status: DispenserStatusSchema,
});

export const TokenDispenserSchemas = {
  [TOKEN_DISPENSER_EVENTS.DISPENSE]: DispenseRequestSchema,
  [TOKEN_DISPENSER_EVENTS.RETURN]: z.void(),
  [TOKEN_DISPENSER_EVENTS.STATUS]: z.void(),
  [TOKEN_DISPENSER_EVENTS.RESET]: z.void(),
} satisfies Record<keyof TokenDispenserEventMap, z.ZodType>;

/**
 * 원인은 **닫힌 집합**으로만 내보낸다 — 장치 응답 코드·전문·내부 상태는 서비스 안에 남는다.
 * 프론트가 raw 코드를 보면 장치 교체가 화면 수정으로 번진다.
 */
export const ZodTokenDispenserCause = z.enum(
  Object.keys(TOKEN_DISPENSER_ERROR_CODE) as [
    TokenDispenserCause,
    ...TokenDispenserCause[],
  ],
);

export const TokenDispenserResponseSchemas = {
  [TOKEN_DISPENSER_EVENTS.DISPENSE]: resultSchemaOf(
    DispenseResultSchema,
    ZodTokenDispenserCause,
  ),
  [TOKEN_DISPENSER_EVENTS.RETURN]: resultSchemaOf(
    DispenserStatusSchema,
    ZodTokenDispenserCause,
  ),
  [TOKEN_DISPENSER_EVENTS.STATUS]: resultSchemaOf(
    DispenserStatusSchema,
    ZodTokenDispenserCause,
  ),
  [TOKEN_DISPENSER_EVENTS.RESET]: resultSchemaOf(
    DispenserStatusSchema,
    ZodTokenDispenserCause,
  ),
} satisfies Record<keyof TokenDispenserEventMap, z.ZodType>;

export type DispenseResult = z.infer<typeof DispenseResultSchema>;

export type TokenDispenserEventMap = {
  [TOKEN_DISPENSER_EVENTS.DISPENSE]: {
    request: z.infer<typeof DispenseRequestSchema>;
    response: Result<DispenseResult, TokenDispenserCause>;
  };
  [TOKEN_DISPENSER_EVENTS.RETURN]: {
    request: void;
    response: Result<DispenserStatus, TokenDispenserCause>;
  };
  [TOKEN_DISPENSER_EVENTS.STATUS]: {
    request: void;
    response: Result<DispenserStatus, TokenDispenserCause>;
  };
  [TOKEN_DISPENSER_EVENTS.RESET]: {
    request: void;
    response: Result<DispenserStatus, TokenDispenserCause>;
  };
};
