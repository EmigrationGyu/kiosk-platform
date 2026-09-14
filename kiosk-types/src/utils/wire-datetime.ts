/**
 * 카드결제 승인일시의 도메인 계약 = **ISO 8601 (+09:00)**.
 *
 * 단말은 저마다 다른 압축 포맷을 돌려주지만(DaouVP/Kovan 14자리, NICE 12자리) 도메인 경계를 넘는
 * 값은 항상 ISO 다 — 어댑터가 **생산할 때 올리고 소비할 때 자기 wire 포맷으로 내린다.** 이 규칙이
 * 없으면 취소 요청의 `originalApprovedAt` 이 단말마다 다른 의미를 갖고, "원거래를 못 찾음"
 * (DaouVP 1094 / Kovan 조회불가)으로 나타난다.
 *
 * `new Date(...).toISOString()` 을 쓰지 않는 이유: 런타임 로컬 TZ 로 epoch 를 계산해 CI(UTC)·비-KST
 * 환경에서 값이 갈린다. 단말이 KST 로 주므로 `+09:00` 을 명시해 박는다.
 */

import type { IsoKst } from '../brands';

/** ISO 8601 (+09:00) 문자열. 형식 판별용 — `2026-08-12T17:55:17+09:00`. */
const ISO_KST = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}\+09:00$/;

/**
 * 단말 압축 타임스탬프 → ISO 8601 (+09:00). `YYYYMMDDhhmmss`(14) 와 `YYMMDDhhmmss`(12) 를 받고,
 * 12자리는 21세기로 해석한다(단말 운영 시점 기준 20세기 거래는 없다).
 *
 * 형식이 어긋나면 `null` — 브랜드가 거짓말을 하지 않으려면 여기서 정직해야 한다. 호출측이 raw 를
 * 영속 로그에 남겨 수동 취소 경로를 확보한다.
 */
export function kstStampToIso(stamp: string): IsoKst | null {
  const digits =
    stamp.length === 14 ? stamp : stamp.length === 12 ? `20${stamp}` : '';
  if (!/^\d{14}$/.test(digits)) return null;
  const [, y, mo, d, h, mi, s] =
    digits.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/) ?? [];
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00` as IsoKst;
}

/**
 * ISO → `YYYYMMDD` (DaouVP 원승인일자). ISO 가 아니면 원본 그대로 — 어긋난 값은 단말이 거절하면서
 * 로그로 드러난다.
 */
export function isoToYyyyMmDd(iso: IsoKst): string {
  const m = iso.match(ISO_KST);
  return m ? `${m[1]}${m[2]}${m[3]}` : iso;
}

/** ISO → `YYMMDD` (NICE #17 원거래일자 · Kovan oriDate). */
export function isoToYyMmDd(iso: IsoKst): string {
  const m = iso.match(ISO_KST);
  return m ? `${m[1]?.slice(2)}${m[2]}${m[3]}` : iso;
}

/**
 * Date → ISO 8601 (+09:00). 단말 전문이 아니라 키오스크 자체 시각을 도메인 계약으로 올리는 origin.
 * `toISOString()` 은 UTC `Z` 를 내므로 같은 순간이라도 형태가 갈린다 — 계약을 하나로 유지하려고
 * KST 자릿수로 직접 조립한다.
 */
export function dateToKstIso(d: Date): IsoKst {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}T${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}:${p(kst.getUTCSeconds())}+09:00` as IsoKst;
}
