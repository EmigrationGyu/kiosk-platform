import { IDLE_DEFAULT_TIMEOUT_MS } from '@/shared/constants/idle';
import { createStore } from './storeRegistry';

/**
 * 브랜딩된 idle 억제 키 타입. `idleDisableKey()` 로 만든 심볼만 이 타입에 대입된다.
 * 임의의 `Symbol()` 이나 다른 스토어(globalDisable 등)의 키는 컴파일 단계에서 거부되어,
 * "이 스토어의 키만" 이라는 닫힌 집합이 타입으로 강제된다.
 */
declare const idleDisableKeyBrand: unique symbol;
export type IdleDisableKey = symbol & { readonly [idleDisableKeyBrand]: never };

/**
 * idle 억제 키를 만드는 유일한 경로. 반드시 아래 `IDLE_DISABLE_KEYS` 에만 등록해 닫힌 집합을 유지한다.
 */
export const idleDisableKey = (description: string): IdleDisableKey =>
  Symbol(description) as IdleDisableKey;

/**
 * 전역 idle 억제 키(닫힌 집합). `globalDisableStore` 와 동일한 심볼 키셋 패턴.
 *
 * 하나라도 잡혀 있으면 idle 카운트다운을 정지한다. 명령형으로 add/remove 하므로
 * 컴포넌트 생명주기에 결합되지 않는다(요구가 복잡해져도 개발자가 지점을 직접 통제).
 * 겹침 안전: 서로 다른 두 구간이 동시에 잡아도 각자 remove 될 때까지 유지된다.
 *
 * 기획 확정 시 실제 키를 여기에 추가하고, 해당 화면/훅에서 add/removeIdleDisableKey 를 호출한다.
 * @example IDLE_DISABLE_KEYS = { CARD_PAYMENT: idleDisableKey('suppress idle during card session') }
 */
export const IDLE_DISABLE_KEYS = {
  // goHome 실행 중(세션 리셋 await) idle 억제 — 재-warn 방지. isGlobalDisabled 와 lockstep.
  GO_HOME: idleDisableKey('suppress idle during goHome cleanup'),
  // 원격 키 발급 디스펜싱(최대 150s) 중 idle 억제 — 발급 도중 idle 이 홈복귀시키지 않게.
  REMOTE_KEY_ISSUANCE: idleDisableKey(
    'suppress idle during remote key issuance',
  ),
  // 관리자 카드 수거 모드 ON 동안 idle 억제 — 현장 직원이 카드를 모으는 사이
  // 무동작으로 판정돼 홈으로 튕기면 투입구가 열린 채 화면만 바뀐다.
  ADMIN_CARD_COLLECT: idleDisableKey('suppress idle during admin card collect'),
  // 관리자 명령이 도는 동안 idle 억제 — 카드 결제 왕복처럼 화면을 만지지 않고
  // 몇 분씩 기다리는 명령이 있어, 진행 중에 홈으로 튕기면 거래가 붕 뜬다.
  ADMIN_COMMAND: idleDisableKey('suppress idle during admin command'),
  // 현금 투입/방출 왕복 중 idle 억제 — 지폐를 넣는 동작은 DOM 활동이 아니라
  // (domActivity 는 pointerdown/touchstart/keydown 만 듣는다) 손님이 지갑을 뒤지는
  // 동안 무동작으로 판정된다. 기계 안에 돈이 있는 채로 홈으로 튕기면 그 돈은
  // 아무도 돌려주지 않는다. 반드시 `DISABLE_KEYS.CASH_INFLIGHT` 와 lockstep
  // (`useCashDeviceLock` 이 둘을 한 지점에서 잡는다).
  CASH_INFLIGHT: idleDisableKey('suppress idle during cash device round-trip'),
  // 체크인 발급(카드키·영수증) 진행 중 idle 억제. 여러 장 발급은 장마다 손님이
  // 카드를 집어갈 때까지 기다리므로 — 그 대기는 DOM 활동이 아니다 — 무동작으로
  // 판정돼 발급 도중 홈으로 튕길 수 있다.
  CHECK_IN_ISSUANCE: idleDisableKey('suppress idle during check-in issuance'),
  // 원격 결제 취소 명령이 실행 중(begin→settle) idle 억제. 취소는 홈 관문 위에 모달로
  // 돌아 1분 관문 복귀 스트림에 걷히면 명령이 소진된다 — 손님이 오기도 전에 사라진다.
  // 3분 수거 스트림은 이 키를 보지 않으므로 동의 관문의 대기 예산은 그대로 3분이다.
  REMOTE_CANCEL: idleDisableKey('suppress idle during remote payment cancel'),
  // 기획 확정 시 추가 — 예: CARD_PAYMENT ...
} as const;

interface IdleStore {
  /** 파생값: 잡힌 disable 키가 하나라도 있으면 true. */
  isIdleDisabled: boolean;
  /** 무동작 판단까지의 현재 대기 시간(ms). 화면별로 매뉴얼 오버라이드 가능. */
  timeoutMs: number;
  /**
   * idle 상태 머신의 phase 판별자이자 경고 자동리셋 시각(`performance.now` 기준 ms).
   *   - `null`  → COUNTING (경고 아님. 무동작 카운팅은 엔진의 setTimeout 이 담당)
   *   - number  → WARNING  (이 시각에 자동 리셋). 경고 오버레이의 유일한 트리거.
   */
  warningDeadline: number | null;

  addIdleDisableKey: (key: IdleDisableKey) => void;
  removeIdleDisableKey: (key: IdleDisableKey) => void;
  setIdleTimeoutMs: (ms: number) => void;

  /** 경고 진입 — 자동 리셋 deadline 설정(COUNTING→WARNING). 엔진이 무동작 timeout 초과 시 호출. */
  beginWarning: (deadline: number) => void;
  /** 경고 오버레이 내림(WARNING→COUNTING). 버튼 resume·비활성 전이·발화 시 호출. warningDeadline=null. */
  dismissWarning: () => void;
  /**
   * idle 상태를 기본값으로 복원 — disable 키 전체 해제 + timeoutMs 기본값 + 경고 해제.
   * 세션 관문인 goHome 에서 호출되어, 매뉴얼로 꺼둔 상태가 세션 경계를 넘지 못하게 한다.
   */
  resetIdle: () => void;
}

// 모듈 스코프(비공개) — globalDisableStore 와 동일하게 키 집합을 외부에 노출하지 않는다.
const idleDisableKeySet = new Set<IdleDisableKey>();

/** 현재 잡힌 idle disable 키 description 배열. 디버그/로깅 전용. */
export const getActiveIdleDisableKeys = (): string[] =>
  Array.from(idleDisableKeySet).map((k) => k.description ?? '<unnamed>');

export const useIdleStore = createStore<IdleStore>((set) => ({
  isIdleDisabled: false,
  timeoutMs: IDLE_DEFAULT_TIMEOUT_MS,
  warningDeadline: null,
  addIdleDisableKey: (key: IdleDisableKey) => {
    if (!idleDisableKeySet.has(key)) {
      idleDisableKeySet.add(key);
      set({ isIdleDisabled: idleDisableKeySet.size > 0 });
    }
  },
  removeIdleDisableKey: (key: IdleDisableKey) => {
    if (idleDisableKeySet.delete(key)) {
      set({ isIdleDisabled: idleDisableKeySet.size > 0 });
    }
  },
  setIdleTimeoutMs: (ms: number) => set({ timeoutMs: ms }),
  beginWarning: (deadline: number) => set({ warningDeadline: deadline }),
  dismissWarning: () => set({ warningDeadline: null }),
  resetIdle: () => {
    idleDisableKeySet.clear();
    set({
      isIdleDisabled: false,
      timeoutMs: IDLE_DEFAULT_TIMEOUT_MS,
      warningDeadline: null,
    });
  },
}));

// 편의 셀렉터 훅
export const useIsIdleDisabled = () => useIdleStore((s) => s.isIdleDisabled);
export const useIdleWarningDeadline = () =>
  useIdleStore((s) => s.warningDeadline);
