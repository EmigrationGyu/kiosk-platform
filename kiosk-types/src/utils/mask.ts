// PII 마스킹 유틸 (전화번호·카드번호 등).
//
// 핵심 규칙: 구분자('-', 공백, '+', '.' 등)는 가변적이므로 split 하지 않고 "숫자 위치" 기준으로만
// 마스킹한다. 영수증 등 표시 직전(프론트 payload 구성 시점)에 적용해 raw PII 가 IPC 경계를 넘지 않게 한다.

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

const countDigits = (value: string): number => {
  let n = 0;
  for (const c of value) if (isDigit(c)) n++;
  return n;
};

/**
 * 앞 `keepStart` 자리와 뒤 `keepEnd` 자리만 남기고 가운데 숫자를 `maskChar` 로 치환.
 * 구분자/기호는 위치 그대로 보존. 보존 자릿수 합이 전체 이상이면 마스킹하지 않음
 * (짧은 값 과다노출 방지가 아니라, 가릴 게 없으면 그대로 — 정책은 래퍼가 정한다).
 */
export function maskDigits(
  value: string,
  {
    keepStart,
    keepEnd,
    maskChar = '*',
  }: { keepStart: number; keepEnd: number; maskChar?: string },
): string {
  const digitCount = countDigits(value);
  if (keepStart + keepEnd >= digitCount) return value;

  let idx = -1;
  let out = '';
  for (const c of value) {
    if (!isDigit(c)) {
      out += c;
      continue;
    }
    idx++;
    const keep = idx < keepStart || idx >= digitCount - keepEnd;
    out += keep ? c : maskChar;
  }
  return out;
}

/**
 * 전화번호 마스킹 — 가운데 2자리만 가린다. (예: 010-1234-5678 → 010-1**4-5678)
 * 자릿수가 홀수면 중앙에서 약간 앞쪽 2자리. 3자리 미만이면 그대로.
 */
export function maskPhone(value: string, maskChar = '*'): string {
  const digitCount = countDigits(value);
  if (digitCount < 3) return value;
  const keepStart = Math.floor((digitCount - 2) / 2);
  const keepEnd = digitCount - keepStart - 2;
  return maskDigits(value, { keepStart, keepEnd, maskChar });
}

/**
 * 카드번호 마스킹 — 앞 6자리(BIN)만 노출, 나머지 뒤 숫자는 전부 가린다.
 * (예: 5525-7612-3456-7890 → 5525-76**-****-****)
 */
export function maskCardNumber(
  value: string,
  {
    keepStart = 6,
    maskChar = '*',
  }: { keepStart?: number; maskChar?: string } = {},
): string {
  return maskDigits(value, { keepStart, keepEnd: 0, maskChar });
}

// ── 성명·생년월일·차량번호 ──────────────────────────────────────────────────
//
// 위 숫자 기반 마스킹과 달리 이쪽은 **자릿수가 아니라 의미**로 가린다. 로그 파일의
// 출력 항목 최소화(조치 A-10, 안전성 확보조치 기준 제12조제1항)가 목적이라, 사람이
// "누구인지"는 못 알아보되 "같은 사람인지"는 대조할 수 있어야 한다.
//
// 셋 다 **멱등**이다 — 경계에서 마스킹하는데 출처가 이미 마스킹한 값이 올라올 수 있다.

/**
 * 성명 — 가운데를 가린다. `홍길동` → `홍*동`, 2글자는 뒷글자(`홍*`), 1글자는 그대로.
 *
 * 해시가 아니라 마스킹인 이유: 운영이 로그를 눈으로 읽는다. `홍*동` 은 "명부에 있었나"를
 * 대조할 수 있으면서 사람이 스캔할 수 있지만, 해시는 대조는 되어도 읽히지 않는다.
 * 대가는 충돌(홍길동·홍갈동이 같은 값)인데, 진단에는 점수·순위가 함께 찍히므로 감당된다.
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${'*'.repeat(trimmed.length - 2)}${trimmed.at(-1)}`;
}

/** 생년월일(YYYYMMDD) → `1990.**.**`. 연도만 남긴다 — 성년 판정 확인엔 그걸로 족하다. */
export function maskBirth(birth: string): string {
  const year = birth.trim().slice(0, 4);
  return year.length === 4 && /^\d{4}$/.test(year)
    ? `${year}.**.**`
    : '****.**.**';
}

/** 차량번호 — 앞 2자리와 뒤 2자리만. `12가3456` → `12가**56`. 한글 구분자는 위치 보존. */
export function maskVehicleNumber(value: string, maskChar = '*'): string {
  if (value.includes(maskChar)) return value;
  return maskDigits(value, { keepStart: 2, keepEnd: 2, maskChar });
}
