import { createStore } from './storeRegistry';

/**
 * 브랜딩된 disable 키 타입. `disableKey()` 로 만든 심볼만 이 타입에 대입된다.
 * 임의의 `Symbol()` 이나 다른 스토어(idle 등)의 키는 컴파일 단계에서 거부되어,
 * add/removeGlobalDisableKey 에는 "이 스토어의 키만" 넣을 수 있다.
 */
declare const disableKeyBrand: unique symbol;
export type DisableKey = symbol & { readonly [disableKeyBrand]: never };

const disableKey = (description: string): DisableKey =>
  Symbol(description) as DisableKey;

interface GlobalDisableStore {
  isGlobalDisabled: boolean;
  /**
   * `CARDKEY_INFLIGHT` 를 제외하고 하나라도 잡혀 있는가 — 즉 **이탈 경로가 스스로 풀 수
   * 없는** 잠금이 있는가. 홈/취소 같은 이탈 버튼의 `disabled` 는 이 값을 본다(`useIsExitBlocked`).
   */
  isExitBlocked: boolean;
  addGlobalDisableKey: (key: DisableKey) => void;
  removeGlobalDisableKey: (key: DisableKey) => void;
}

export const DISABLE_KEYS = {
  ACCOUNT_LOGIN: disableKey('disable while signing in with account id'),
  ADMIN_AUTH: disableKey('disable while claiming admin one-time code'),
  OTP_LOGIN: disableKey('disable while claiming kiosk provisioning code'),
  SEARCH_RESERVATION_NAME: disableKey(
    'disable while searching reservation name',
  ),
  SEARCH_RESERVATION_NUMBER: disableKey(
    'disable while searching reservation number',
  ),
  QUOTE_EARLY_CHECK_IN: disableKey(
    'disable while fetching early check-in fee quote',
  ),
  AUTO_ASSIGN_ROOM: disableKey(
    'disable while auto-assigning room to reservation',
  ),
  CHARGE_EARLY_CHECK_IN_FEE: disableKey(
    'disable while charging early check-in fee',
  ),
  CHECK_OCR_ID: disableKey('disable while checking ocr id'),
  CHECK_MOBILE_ID_CPM: disableKey('disable while checking mobile id cpm'),
  COLLECT_VEHICLE_INFORMATION: disableKey(
    'disable while collecting vehicle information',
  ),
  COLLECT_USER_CONTACT_INFORMATION: disableKey(
    'disable while collecting user contact information',
  ),
  HEALTH_CHECK_PAYMENT_METHOD: disableKey(
    'disable while checking payment method',
  ),
  CREATE_WALK_IN_RESERVATION: disableKey(
    'disable while creating walk-in reservation',
  ),
  PROBE_CARD_READER: disableKey('disable while probing card reader'),
  GO_HOME: disableKey('disable while running goHome cleanup'),
  CHECK_OUT: disableKey('disable while running checkout mutation'),
  SELECT_KIOSK: disableKey('disable while binding kiosk token'),
  CARD_TXN_INFLIGHT: disableKey(
    'disable while card terminal session is in-flight',
  ),
  CARDKEY_INFLIGHT: disableKey(
    'disable while cardkey dispenser request is in-flight',
  ),
  CASH_INFLIGHT: disableKey(
    'disable while cash dispenser deposit/dispense is in-flight',
  ),
  PAYMENT_FINISH: disableKey(
    'disable while finishing payment (settle/materialize/cancel)',
  ),
} as const;

// 모듈 스코프(비공개)에서 키를 관리하여 외부에 노출되지 않도록 함
const disableKeySet = new Set<DisableKey>();

/**
 * 현재 잡혀있는 disable key 들의 description 배열. 디버그/로깅 전용.
 * 운영 흐름에서 직접 의사결정에 사용 금지 — 상태 분기는 isGlobalDisabled 로만.
 */
export const getActiveDisableKeys = (): string[] =>
  Array.from(disableKeySet).map((k) => k.description ?? '<unnamed>');

/** 파생 상태는 한 곳에서만 계산한다 — 키 집합은 계속 모듈 비공개로 둔다. */
const snapshot = () => ({
  isGlobalDisabled: disableKeySet.size > 0,
  isExitBlocked: Array.from(disableKeySet).some(
    (key) => key !== DISABLE_KEYS.CARDKEY_INFLIGHT,
  ),
});

export const useGlobalDisableStore = createStore<GlobalDisableStore>((set) => ({
  isGlobalDisabled: false,
  isExitBlocked: false,
  addGlobalDisableKey: (key: DisableKey) => {
    if (!disableKeySet.has(key)) {
      disableKeySet.add(key);
      set(snapshot());
    }
  },
  removeGlobalDisableKey: (key: DisableKey) => {
    if (disableKeySet.delete(key)) {
      set(snapshot());
    }
  },
}));

// 편의 셀렉터 훅
export const useIsGlobalDisabled = () =>
  useGlobalDisableStore((s) => s.isGlobalDisabled);

/**
 * 이탈(goHome) 버튼 전용 잠금.
 *
 * `isGlobalDisabled` 를 그대로 쓰면 **카드 투입 대기(무장) 동안 내내 true** 라서 이탈
 * 버튼이 통째로 막힌다 — 무장은 장비가 손님을 기다리는 중이지 명령이 오가는 중이 아니다.
 * 게다가 이탈 경로는 `abortWait()` 로 그 잠금을 **동기로 먼저 풀고** goHome 을 부르므로,
 * 버튼을 막을 이유가 없다.
 *
 * 나머지 잠금(결제 정산·체크아웃 뮤테이션 등)은 그대로 막는다 — 안 막으면 눌렸을 때
 * `useSafeGoHome` 진입 가드가 **조용히 거절**해(로그만 남김) 아무 일도 안 일어난 것처럼 보인다.
 */
export const useIsExitBlocked = () =>
  useGlobalDisableStore((s) => s.isExitBlocked);
