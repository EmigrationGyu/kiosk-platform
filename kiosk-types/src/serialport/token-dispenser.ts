import { z } from 'zod';
import { SerialOptionsSchema } from './common';

/**
 * 백엔드 ↔ 토큰 디스펜서 서브프로세스 계약.
 *
 * 장치는 가상의 TD-200 — 호퍼에 쌓인 토큰을 한 장씩 게이트로 밀어내고, 회수하면
 * 반환함에 넣는다. 경로 위 세 지점(호퍼 출구·중간·게이트)에 광센서가 있어 상태
 * 바이트로 보고한다. 프로토콜 전문은 `packages/token-dispenser/PROTOCOL.md`.
 */
export const TOKEN_DISPENSER_ENDPOINTS = {
  PORT_ASSIGNED: '/token_dispenser/port-assigned',
  /** 성공 = 이 서브프로세스가 COM 포트를 쥐고 있지 않음(멱등). serialport README 참고. */
  RELEASE_PORT: '/token_dispenser/release-port',
  HEALTH_CHECK: '/token_dispenser/health-check',
  /** 토큰 한 장을 게이트(손이 닿는 위치)까지 내보낸다. */
  DISPENSE: '/token_dispenser/dispense',
  /** 게이트 앞까지만 — 아직 손이 닿지 않는 대기 위치. */
  DISPENSE_TO_HOLD: '/token_dispenser/dispense-to-hold',
  /** 게이트의 토큰을 반환함으로 되돌린다. */
  RETURN_TOKEN: '/token_dispenser/return-token',
  /** 게이트의 토큰을 호퍼로 되돌린다(재사용). */
  COLLECT_TO_HOPPER: '/token_dispenser/collect-to-hopper',
  /** 자동 급지 → 명령 급지 전환. */
  SET_COMMAND_FEEDING: '/token_dispenser/set-command-feeding',
  RESET: '/token_dispenser/reset',
} as const;

/**
 * 장치가 보고하는 상태 플래그.
 *
 * 이 필드들이 FSM 전이 술어의 정의역이다 — 어느 조합이 "진행 중"이고 어느 조합이
 * "에러"인지는 `packages/token-dispenser/src/fsm/transitions.ts` 가 정한다.
 */
export const DispenserStatusSchema = z.object({
  /** 반환함이 가득 참 — 더 회수할 수 없다. */
  returnBoxFull: z.boolean(),
  /** 지금 새 명령을 받을 수 없는 상태(장치 내부 사유). */
  commandNotExecutable: z.boolean(),
  hopperPreFull: z.boolean(),
  hopperFull: z.boolean(),
  /** 방출 진행 중. */
  dispensing: z.boolean(),
  /** 회수 진행 중. */
  collecting: z.boolean(),
  dispenseError: z.boolean(),
  returnError: z.boolean(),
  /** 두 장이 겹쳐 물림. */
  tokenOverlap: z.boolean(),
  tokenJam: z.boolean(),
  tokenPreEmpty: z.boolean(),
  tokenEmpty: z.boolean(),
  /** 경로 위 세 광센서 — 호퍼 출구 → 중간 → 게이트 순. */
  tokenAtHopper: z.boolean(),
  tokenAtMid: z.boolean(),
  tokenAtGate: z.boolean(),
});

export type DispenserStatus = z.infer<typeof DispenserStatusSchema>;

export const TokenDispenserSerialSchemas = {
  [TOKEN_DISPENSER_ENDPOINTS.PORT_ASSIGNED]: SerialOptionsSchema,
  [TOKEN_DISPENSER_ENDPOINTS.RELEASE_PORT]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.HEALTH_CHECK]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.DISPENSE]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.DISPENSE_TO_HOLD]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.RETURN_TOKEN]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.COLLECT_TO_HOPPER]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.SET_COMMAND_FEEDING]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.RESET]: z.void(),
} satisfies Record<keyof TokenDispenserSerialEventMap, z.ZodType>;

export const TokenDispenserSerialResponseSchemas = {
  [TOKEN_DISPENSER_ENDPOINTS.PORT_ASSIGNED]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.RELEASE_PORT]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.HEALTH_CHECK]: DispenserStatusSchema,
  [TOKEN_DISPENSER_ENDPOINTS.DISPENSE]: DispenserStatusSchema,
  [TOKEN_DISPENSER_ENDPOINTS.DISPENSE_TO_HOLD]: DispenserStatusSchema,
  [TOKEN_DISPENSER_ENDPOINTS.RETURN_TOKEN]: DispenserStatusSchema,
  [TOKEN_DISPENSER_ENDPOINTS.COLLECT_TO_HOPPER]: DispenserStatusSchema,
  [TOKEN_DISPENSER_ENDPOINTS.SET_COMMAND_FEEDING]: z.void(),
  [TOKEN_DISPENSER_ENDPOINTS.RESET]: DispenserStatusSchema,
} satisfies Record<keyof TokenDispenserSerialEventMap, z.ZodType>;

export type TokenDispenserSerialEventMap = {
  [TOKEN_DISPENSER_ENDPOINTS.PORT_ASSIGNED]: {
    request: z.infer<typeof SerialOptionsSchema>;
    response: void;
  };
  [TOKEN_DISPENSER_ENDPOINTS.RELEASE_PORT]: { request: void; response: void };
  [TOKEN_DISPENSER_ENDPOINTS.HEALTH_CHECK]: {
    request: void;
    response: DispenserStatus;
  };
  [TOKEN_DISPENSER_ENDPOINTS.DISPENSE]: {
    request: void;
    response: DispenserStatus;
  };
  [TOKEN_DISPENSER_ENDPOINTS.DISPENSE_TO_HOLD]: {
    request: void;
    response: DispenserStatus;
  };
  [TOKEN_DISPENSER_ENDPOINTS.RETURN_TOKEN]: {
    request: void;
    response: DispenserStatus;
  };
  [TOKEN_DISPENSER_ENDPOINTS.COLLECT_TO_HOPPER]: {
    request: void;
    response: DispenserStatus;
  };
  [TOKEN_DISPENSER_ENDPOINTS.SET_COMMAND_FEEDING]: {
    request: void;
    response: void;
  };
  [TOKEN_DISPENSER_ENDPOINTS.RESET]: {
    request: void;
    response: DispenserStatus;
  };
};
