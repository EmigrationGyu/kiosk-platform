import {
  maskBirth,
  maskCardNumber,
  maskName,
  maskPhone,
  maskVehicleNumber,
} from '../utils/mask';
import type { Json } from './record';

/**
 * 로그 meta 의 **닫힌 필드 집합**과 필드별 마스킹 정책.
 *
 * 로그 메시지는 상수여야 하고(보간 금지 — `LogArgs` 가 타입으로 막는다) 값은 전부 이 meta 로
 * 온다. 그래서 "무엇이 로그에 나가는가"가 이 파일 하나에 모인다.
 *
 * **왜 닫아야 하나.** 마스킹만으로는 닫히지 않는다. 메시지를 문자열로 조립해 오면 값의 정체가
 * 뭉개져 되찾을 방법이 없고, 마스킹 대상을 거부목록으로 들면 `ownerName`·`userName` 이
 * 생길 때마다 조용히 샌다. 여기 없는 키는 **컴파일이 막으므로**, 새 필드를 넣는 사람은
 * 반드시 "이건 뭐고 어떻게 가리나"를 한 줄로 선언하게 된다.
 *
 * 「개인정보의 안전성 확보조치 기준」 제12조제1항은 **파일생성을 출력에 명시적으로 열거**한다.
 * 로그 파일이 정면으로 적용 대상이다(조치 A-10).
 */

/** 미등록·예상 밖 값의 자리. 키 이름은 남겨야 무엇을 등록해야 하는지 보인다. */
export const UNREGISTERED_VALUE = '[미등록]';

/** 마스킹 정책 — 필드가 아니라 **값의 종류**다. 여러 필드가 같은 정책을 공유한다. */
export type MaskPolicy =
  | 'name'
  | 'birth'
  | 'phone'
  | 'vehicle'
  | 'card'
  | 'plain'
  | 'nested';

/** 가리지 않음. **"가릴 필요 없다"도 선언이다** — 빠뜨린 것과 구별되어야 한다. */
const keep = (value: string): string => value;

/**
 * 컨테이너(배열·객체)로 선언된 필드에 **문자열이 도착한 경우**. 배열·객체는 마스커에
 * 닿기 전에 원소·안쪽 키로 분해되므로, 여기까지 문자열이 왔다는 건 호출부가 목록을
 * 이어 붙여 보냈다는 뜻이다 — `홍길동, 김철수` 한 덩어리가 그대로 샌다. 버린다.
 */
const unexpected = (): string => UNREGISTERED_VALUE;

/**
 * 정책 → 마스킹 함수 1:1. `satisfies` 가 **모든 정책에 정확히 하나**를 강제하므로,
 * 정책을 늘리면 여기가 컴파일 에러로 묻는다.
 */
export const MASKERS = {
  name: maskName,
  birth: maskBirth,
  phone: maskPhone,
  vehicle: maskVehicleNumber,
  card: maskCardNumber,
  plain: keep,
  nested: unexpected,
} as const satisfies Record<MaskPolicy, (value: string) => string>;

/**
 * 필드 → 정책 1:1. **키가 곧 로그에 찍히는 라벨**이다(`guestName=홍*동`).
 *
 * 이름을 하나로 두는 이유: 키와 별도 라벨을 두면 둘이 어긋나도 타입이 못 막고,
 * 코드에서 `guestName` 을 grep 했을 때 호출부와 로그 줄이 같이 잡히지 않는다.
 *
 * 같은 종류의 값이 여럿이면 **키를 다르게** 둔다(`guestName` vs `searchName`) — 그래야
 * 로그를 읽는 사람이 "예약자인지 검색어인지"를 가릴 수 있다. 같은 의미의 여러 값은 배열로,
 * 구조가 있으면 중첩 객체로 넘긴다(둘 다 원소·안쪽 키가 각자 판정된다).
 */
export const LOG_FIELDS = {
  // ── 개인정보 ────────────────────────────────────────────────────────────
  /** 예약자 성명. */
  guestName: 'name',
  /** 손님이 검색창에 입력한 이름 — 예약자명과 **대조 대상**이라 반드시 구별한다. */
  searchName: 'name',
  /** 검색 대상 명부(배열). "그 이름이 애초에 명부에 있었나"가 미검색 진단의 첫 갈림길이다. */
  guestNames: 'name',
  /**
   * 신분증에서 판독한 성명 — 예약자명(`guestName`)과 **다를 수 있다는 것이 요점**이다.
   * 둘이 어긋나는 것이 미검색 진단의 핵심 갈림길이라 키를 나눈다.
   */
  idName: 'name',
  birth: 'birth',
  phone: 'phone',
  vehicleNumber: 'vehicle',
  cardNumber: 'card',
  /**
   * 현금영수증 식별번호 — 휴대폰번호 또는 사업자번호가 온다. 손님 연락처(`phone`)와 값의
   * 종류는 같지만 **용도가 달라** 키를 나눈다. 로그를 읽는 사람이 "손님 연락처인지 영수증
   * 식별번호인지"를 가려야 한다.
   */
  cashReceiptId: 'phone',

  // ── 개인정보 아님 ───────────────────────────────────────────────────────
  roomName: 'plain',
  roomTypeName: 'plain',
  /** 매칭 후보 목록 — `[{ guestName, score }]`. 안쪽 키가 각자 판정된다. */
  matches: 'nested',
  /** 임계값을 못 넘고 떨어진 근접 후보 — 미검색 진단의 핵심. */
  nearMisses: 'nested',
  /**
   * 이름 검색 시도 계획 — `[{ searchName, unmasked: { label, minScore } }]`.
   * 시도마다 **입력이 달라지므로**(정규화·로마자화 변형) 각 변형이 원소로 보여야 한다.
   */
  searchAttempts: 'nested',
  /** 발음 게이트에서 0 점이 된 후보 — `[{ guestName, … }]`. 게이트가 조인 건지 입력이 딴판인지 가른다. */
  gateRejects: 'nested',
  score: 'plain',
  reservationId: 'plain',
  /** 실패한 핸들러의 문맥 라벨 — `withErrorHandler` 가 호출부에서 받아 넘긴다. */
  context: 'plain',
  idType: 'plain',
  attempt: 'plain',
  variant: 'plain',
  cause: 'plain',
  code: 'plain',
} as const satisfies Record<string, MaskPolicy>;

export type LogField = keyof typeof LOG_FIELDS;

/**
 * 로그에 실을 수 있는 값들. 키는 `LOG_FIELDS` 로 닫혀 있고, **객체 리터럴 초과 속성 검사**가
 * 미등록 키를 컴파일에서 거부한다.
 *
 * 값은 `Json` 이다 — 로그는 소켓·NDJSON 을 건너므로 직렬화 불가능한 값(함수·Blob)이 들어오면
 * 파일엔 `{}` 만 남는다. 타입에서 막는 편이 낫다. 무엇을 어떻게 가릴지는 값의 모양이 아니라
 * **키의 정책**이 정한다.
 */
export type LogMeta = Partial<Record<LogField, Json>> & {
  /**
   * **마스킹하지 않고 그대로 남길 값들.** 장비 프로토콜 진단(전문·BCC·포트·리턴코드)처럼
   * 개인정보가 아니면서 어휘가 무한한 값들이 여기로 온다 — 그것들까지 레지스트리에 등록하면
   * 400개가 넘어 PII 항목이 파묻히고, 결국 사람들이 메시지에 욱여넣는 우회로를 찾는다.
   *
   * **쓰는 것 자체가 선언이다.** 여기 개인정보를 넣는 것을 타입으로 막을 수는 없지만
   * (`guestName: 'plain'` 로 잘못 등록해도 똑같이 샌다 — 레지스트리를 신뢰하는 설계다),
   * 실수로 새는 게 아니라 **적어야 새고**, `grep unmasked` 로 전수가 감사된다.
   */
  unmasked?: Record<string, Json>;
};

/** `unmasked` 는 예약어 — 레지스트리 필드와 겹치면 안 된다. */
export const UNMASKED_KEY = 'unmasked';

/** 값 하나에 그 필드의 정책을 적용한다. 배열은 원소별, 중첩 객체는 안쪽 키가 다시 판정된다. */
export function maskLogValue(field: LogField, value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskLogValue(field, item));
  }
  if (value !== null && typeof value === 'object') return maskLogMeta(value);
  if (typeof value !== 'string') return value;
  return MASKERS[LOG_FIELDS[field]](value);
}

/**
 * meta 트리 전체. 와이어(소켓)·서브프로세스에서 온 레코드는 타입 검사를 거치지 않았으므로
 * **미등록 키는 런타임에 값을 버린다** — 타입이 닿지 않는 면의 방어선이다.
 */
export function maskLogMeta(meta: unknown): unknown {
  if (Array.isArray(meta)) return meta.map(maskLogMeta);
  if (meta === null || typeof meta !== 'object') return meta;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (key === UNMASKED_KEY) {
      // 선언된 탈출구 — 안쪽은 레지스트리를 타지 않는다.
      out[key] = value;
      continue;
    }
    out[key] =
      key in LOG_FIELDS
        ? maskLogValue(key as LogField, value)
        : UNREGISTERED_VALUE;
  }
  return out;
}
