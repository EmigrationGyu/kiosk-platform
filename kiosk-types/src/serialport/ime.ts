import { z } from 'zod';
import {
  ImeProcessKeyRequestSchema,
  ImeSelectCandidateRequestSchema,
  type ImeState,
  ImeStateSchema,
} from '../types/ime';
import { SerialOptionsSchema } from './common';

// BE ↔ IME 서브프로세스 도메인.
// IME 는 시리얼 디바이스가 아니라 rime.dll 을 로드하는 서브프로세스다 — COM 포트 개념이 없어
// PORT_ASSIGNED 는 사실상 미사용(스캐폴드 시드 유지). 서브프로세스는 spawn 시 엔진을 init 하고
// HEALTH_CHECK 로 엔진/스키마 준비 여부를 노출한다. (포트 스캐너와의 정합은 Step3 probe/health)
//
// serialport 도메인 규약: response = raw 성공 데이터(ImeState). 실패(ImeCause)는 res.error →
// HandlerError 엔벨로프로 전파되며 응답 스키마엔 넣지 않는다(cardkey-dispenser 와 동일).
export const IME_ENDPOINTS = {
  PORT_ASSIGNED: '/ime/port-assigned',
  HEALTH_CHECK: '/ime/health-check',
  PROCESS_KEY: '/ime/process-key',
  SELECT_CANDIDATE: '/ime/select-candidate',
  CLEAR: '/ime/clear',
} as const;

export const ImeSerialSchemas = {
  [IME_ENDPOINTS.PORT_ASSIGNED]: SerialOptionsSchema,
  [IME_ENDPOINTS.HEALTH_CHECK]: z.void(),
  [IME_ENDPOINTS.PROCESS_KEY]: ImeProcessKeyRequestSchema,
  [IME_ENDPOINTS.SELECT_CANDIDATE]: ImeSelectCandidateRequestSchema,
  [IME_ENDPOINTS.CLEAR]: z.void(),
} satisfies Record<keyof ImeSerialEventMap, z.ZodType>;

// ── Response schemas (backend Transport 의 IPC 응답 검증용, raw 성공 데이터) ──

export const ImeSerialResponseSchemas = {
  [IME_ENDPOINTS.PORT_ASSIGNED]: z.void(),
  [IME_ENDPOINTS.HEALTH_CHECK]: z.void(),
  [IME_ENDPOINTS.PROCESS_KEY]: ImeStateSchema,
  [IME_ENDPOINTS.SELECT_CANDIDATE]: ImeStateSchema,
  [IME_ENDPOINTS.CLEAR]: ImeStateSchema,
} satisfies Record<keyof ImeSerialEventMap, z.ZodType>;

export type ImeSerialEventMap = {
  [IME_ENDPOINTS.PORT_ASSIGNED]: {
    request: z.infer<typeof SerialOptionsSchema>;
    response: void;
  };
  [IME_ENDPOINTS.HEALTH_CHECK]: {
    request: void;
    response: void;
  };
  [IME_ENDPOINTS.PROCESS_KEY]: {
    request: z.infer<typeof ImeProcessKeyRequestSchema>;
    response: ImeState;
  };
  [IME_ENDPOINTS.SELECT_CANDIDATE]: {
    request: z.infer<typeof ImeSelectCandidateRequestSchema>;
    response: ImeState;
  };
  [IME_ENDPOINTS.CLEAR]: {
    request: void;
    response: ImeState;
  };
};
