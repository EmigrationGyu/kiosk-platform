import { z } from 'zod';
import { type Result, resultSchemaOf } from '../result';
import {
  type ImeCause,
  ImeCauseSchema,
  type ImeEnsureAssetsResult,
  ImeEnsureAssetsResultSchema,
  ImeProcessKeyRequestSchema,
  ImeSelectCandidateRequestSchema,
  type ImeState,
  ImeStateSchema,
} from '../types/ime';

// FE ↔ BE 소켓 도메인. 입력 verb 는 2개(키 델타 / 후보선택)지만 응답은 ImeState 1-shape.
// 조합의 ground truth 는 serialport 서브프로세스의 rime 엔진이며 backend 는 무상태 글루.
export const IME_EVENTS = {
  /** 소프트 키보드가 낸 키 1개를 조합에 append. language 로 스키마(간체/번체/일본어) 보장. */
  PROCESS_KEY: '/process_key',
  /** 후보 index 선택 — 엔진이 확정(commit) or 조합 전진을 결정. */
  SELECT_CANDIDATE: '/select_candidate',
  /** 조합 초기화 — 필드 이탈/취소 시. */
  CLEAR: '/clear',
  /**
   * IME 자산(rime/mozc 번들) 존재 보장 — 없으면 백엔드가 백그라운드 다운로드를 킥한다.
   * 응답은 존재확인+킥의 즉답(네트워크 비대기)이라 부팅(tolerant 위상)에서 불러도 안전.
   */
  ENSURE_ASSETS: '/ensure_assets',
} as const;

export const ImeSchemas = {
  [IME_EVENTS.PROCESS_KEY]: ImeProcessKeyRequestSchema,
  [IME_EVENTS.SELECT_CANDIDATE]: ImeSelectCandidateRequestSchema,
  [IME_EVENTS.CLEAR]: z.void(),
  [IME_EVENTS.ENSURE_ASSETS]: z.void(),
} satisfies Record<keyof ImeEventMap, z.ZodType>;

// ── Response schemas ─────────────────────────────────────────────────────────
// 실패는 엔진 준비 문제에 가깝다(ImeCause). withErrorHandler 가 Result 로 싣는다.

export const ImeResponseSchemas = {
  [IME_EVENTS.PROCESS_KEY]: resultSchemaOf(ImeStateSchema, ImeCauseSchema),
  [IME_EVENTS.SELECT_CANDIDATE]: resultSchemaOf(ImeStateSchema, ImeCauseSchema),
  [IME_EVENTS.CLEAR]: resultSchemaOf(ImeStateSchema, ImeCauseSchema),
  [IME_EVENTS.ENSURE_ASSETS]: resultSchemaOf(
    ImeEnsureAssetsResultSchema,
    ImeCauseSchema,
  ),
} satisfies Record<keyof ImeEventMap, z.ZodType>;

export type ImeEventMap = {
  [IME_EVENTS.PROCESS_KEY]: {
    request: z.infer<typeof ImeProcessKeyRequestSchema>;
    response: Result<ImeState, ImeCause>;
  };
  [IME_EVENTS.SELECT_CANDIDATE]: {
    request: z.infer<typeof ImeSelectCandidateRequestSchema>;
    response: Result<ImeState, ImeCause>;
  };
  [IME_EVENTS.CLEAR]: {
    request: void;
    response: Result<ImeState, ImeCause>;
  };
  [IME_EVENTS.ENSURE_ASSETS]: {
    request: void;
    response: Result<ImeEnsureAssetsResult, ImeCause>;
  };
};
