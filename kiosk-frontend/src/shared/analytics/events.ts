import type { A11yKey } from 'kiosk-types';

/**
 * Flow — 라우트 최상위 도메인. screen step 의 prefix 와 1:1 대응한다.
 * 퍼널을 flow 단위로 끊어 보기 위한 닫힌 집합.
 */
export const FLOWS = [
  'checkin',
  'checkout',
  'dayuse',
  'stay',
  'extend',
  'payment',
  'refund',
  'home',
  'other',
] as const;
export type Flow = (typeof FLOWS)[number];

/**
 * pathname → Flow. 첫 경로 세그먼트만 보고 매핑(라우트 상수에 결합하지 않는다).
 * boot/home/banner/main/login 등 진입 영역은 'home' 으로 묶는다.
 */
export function deriveFlow(pathname: string): Flow {
  const segment = pathname.split('/')[1] ?? '';
  switch (segment) {
    case 'check-in':
      return 'checkin';
    case 'check-out':
    case 'check-room':
      return 'checkout';
    case 'dayuse':
      return 'dayuse';
    case 'stay':
      return 'stay';
    case 'add-inclusion':
      return 'extend';
    case 'payment':
      return 'payment';
    case 'refund':
      return 'refund';
    case '':
    case 'home':
    case 'boot':
    case 'banner':
    case 'main':
    case 'login':
      return 'home';
    default:
      return 'other';
  }
}

// ── 이벤트 이름 (호출부는 전부 이 상수를 쓴다 — 리터럴 금지) ──────────
export const ANALYTICS_EVENTS = {
  SCREEN_VIEWED: 'screen_viewed',
  SCREEN_LEFT: 'screen_left',
  FLOW_STARTED: 'flow_started',
  MODAL_VIEWED: 'modal_viewed',
  MODAL_CLOSED: 'modal_closed',
  RESERVATION_LOOKUP: 'reservation_lookup',
  RESERVATION_CONFIRMED: 'reservation_confirmed',
  SIGNATURE_SUBMITTED: 'signature_submitted',
  ADULT_VERIFICATION: 'adult_verification',
  PAYMENT: 'payment',
  CARD_ISSUED: 'card_issued',
  CHECKIN_COMPLETED: 'checkin_completed',
  INCLUSION_ADDED: 'inclusion_added',
  ROOM_SELECTED: 'room_selected',
  REFUND: 'refund',
  ERROR_SHOWN: 'error_shown',
  SESSION_ABANDONED: 'session_abandoned',
  UI_PRESS: 'ui_press',
  FIELD_FOCUSED: 'field_focused',
  FIELD_COMPLETED: 'field_completed',
} as const;

// ── group 타입 ──
export const ANALYTICS_GROUP = { ACCOMMODATION: 'accommodation' } as const;

// ── prop 값 enum (닫힌 집합 — 타입은 여기서 파생) ──────────────────
export const ABANDON_REASON = {
  IDLE: 'idle',
  MANUAL_HOME: 'manual_home',
  ERROR: 'error',
} as const;
export type AbandonReason =
  (typeof ABANDON_REASON)[keyof typeof ABANDON_REASON];

export const ACTION_RESULT = { SUCCESS: 'success', FAIL: 'fail' } as const;
export type ActionResult = (typeof ACTION_RESULT)[keyof typeof ACTION_RESULT];

export const LOOKUP_BY = { NAME: 'name', CODE: 'code', QR: 'qr' } as const;
export type LookupBy = (typeof LOOKUP_BY)[keyof typeof LOOKUP_BY];

export const LOOKUP_RESULT = {
  FOUND: 'found',
  MULTIPLE: 'multiple',
  NOT_FOUND: 'not_found',
  ERROR: 'error',
} as const;
export type LookupResult = (typeof LOOKUP_RESULT)[keyof typeof LOOKUP_RESULT];

export const VERIFY_METHOD = { ID: 'id', REMOTE: 'remote' } as const;
export type VerifyMethod = (typeof VERIFY_METHOD)[keyof typeof VERIFY_METHOD];

export const VERIFY_RESULT = {
  PASS: 'pass',
  REJECT: 'reject',
  TIMEOUT: 'timeout',
} as const;
export type VerifyResult = (typeof VERIFY_RESULT)[keyof typeof VERIFY_RESULT];

export const REFUND_METHOD = { CASH: 'cash', CARD: 'card' } as const;
export type RefundMethod = (typeof REFUND_METHOD)[keyof typeof REFUND_METHOD];

export const ROOM_MODE = { DAYUSE: 'dayuse', STAY: 'stay' } as const;
export type RoomMode = (typeof ROOM_MODE)[keyof typeof ROOM_MODE];

/**
 * 분석 이벤트 taxonomy — **이벤트명과 허용 props 를 타입으로 못박는다.**
 *
 * 이 맵에 없는 이벤트명이나 선언 안 된 prop 은 컴파일 에러 → 실수로 PII(이름/전화/신분증)가
 * props 에 흘러드는 것을 구조적으로 차단한다. PII 안전은 '문화'가 아니라 '타입'으로 강제된다.
 *
 * 키(이벤트명)·값(enum)은 위 상수에서 파생 — 단일 출처. 호출부도 같은 상수를 쓴다.
 * 규칙:
 * - 값(value)은 절대 넣지 않는다. 의미적 키 + 비-PII 결과만.
 * - 인풋은 값 대신 완료 여부(filled)·길이만.
 */
export type AnalyticsEventMap = {
  // ── 퍼널 백본 ──────────────────────────────
  [ANALYTICS_EVENTS.SCREEN_VIEWED]: { step: string; flow: Flow };
  [ANALYTICS_EVENTS.SCREEN_LEFT]: {
    step: string;
    flow: Flow;
    durationMs: number;
  };
  [ANALYTICS_EVENTS.FLOW_STARTED]: { flow: Flow };
  // 모달 표시/해제 — 결제·약관·성인인증 등 대부분의 단계가 라우트가 아닌 모달이라 퍼널에 필수.
  [ANALYTICS_EVENTS.MODAL_VIEWED]: { modalType: string };
  [ANALYTICS_EVENTS.MODAL_CLOSED]: { modalType: string };

  // ── 도메인 액션(결과 포함) ──────────────────
  [ANALYTICS_EVENTS.RESERVATION_LOOKUP]: { by: LookupBy; result: LookupResult };
  [ANALYTICS_EVENTS.RESERVATION_CONFIRMED]: Record<string, never>;
  [ANALYTICS_EVENTS.SIGNATURE_SUBMITTED]: { result: ActionResult };
  [ANALYTICS_EVENTS.ADULT_VERIFICATION]: {
    method: VerifyMethod;
    result: VerifyResult;
  };
  [ANALYTICS_EVENTS.PAYMENT]: {
    // 결제 수단은 서버 enum 을 그대로 재사용했다 — 로컬에 다시 적으면 두 진실이 생긴다.
    // 실패(cause)는 전용 이벤트로 안 잡고 modal_viewed 로 커버 → K-코드/전문 누수 자체 없음.
    method: string;
    result: ActionResult;
  };
  [ANALYTICS_EVENTS.CARD_ISSUED]: Record<string, never>;
  [ANALYTICS_EVENTS.CHECKIN_COMPLETED]: Record<string, never>;
  // 투숙 중 서비스 추가의 성공 종착. 무엇을 샀는지는 두 축의 유무만 — 상품명·금액·수량은
  // 싣지 않는다(업장 단위 매출은 PMS 가 진실이고, 여기 필요한 건 퍼널 분기뿐).
  [ANALYTICS_EVENTS.INCLUSION_ADDED]: {
    hasLateCheckout: boolean;
    hasInclusion: boolean;
  };
  [ANALYTICS_EVENTS.ROOM_SELECTED]: { mode: RoomMode };
  [ANALYTICS_EVENTS.REFUND]: { method: RefundMethod };
  [ANALYTICS_EVENTS.ERROR_SHOWN]: { errorKey: string; step: string };

  // ── 키오스크 이탈 신호 ──────────────────────
  [ANALYTICS_EVENTS.SESSION_ABANDONED]: {
    stepAtAbandon: string;
    reason: AbandonReason;
  };

  // ── 보조: 상호작용 히트맵(A11yNode 이음새, 샘플링) ──
  [ANALYTICS_EVENTS.UI_PRESS]: { a11yKey: A11yKey };
  // 입력 필드 — onChange 노이즈/PII 회피. focus(진입) + completed(편집종료) 만, 값은 안 싣고 길이만.
  [ANALYTICS_EVENTS.FIELD_FOCUSED]: { a11yKey: A11yKey };
  [ANALYTICS_EVENTS.FIELD_COMPLETED]: {
    a11yKey: A11yKey;
    filled: boolean;
    length?: number;
  };
};

export type AnalyticsEvent = keyof AnalyticsEventMap;
