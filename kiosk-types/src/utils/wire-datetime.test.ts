import { describe, expect, it } from 'bun:test';
import type { IsoKst } from '../brands';
import {
  dateToKstIso,
  isoToYyMmDd,
  isoToYyyyMmDd,
  kstStampToIso,
} from './wire-datetime';

/** 계약 위반 입력을 일부러 먹이기 위한 캐스트 — 프로덕션 경로엔 없다. */
const asIso = (s: string) => s as IsoKst;

const ISO = asIso('2026-08-12T17:55:17+09:00');

describe('kstStampToIso', () => {
  it('14자리 YYYYMMDDhhmmss (DaouVP · Kovan)', () => {
    expect(kstStampToIso('20260812175517')).toBe(ISO);
  });

  it('12자리 YYMMDDhhmmss (NICE)', () => {
    expect(kstStampToIso('260812175517')).toBe(ISO);
  });

  it('런타임 TZ 와 무관하게 +09:00 을 박는다', () => {
    // toISOString() 을 썼다면 CI(UTC) 에서 08:55Z 로 밀렸을 값.
    expect(kstStampToIso('20260812175517')?.endsWith('+09:00')).toBe(true);
  });

  it('형식이 어긋나면 null — 브랜드가 거짓말하지 않게', () => {
    for (const bad of ['', 'abc', '2026081217551', ISO]) {
      expect(kstStampToIso(bad)).toBeNull();
    }
  });
});

describe('isoToYyyyMmDd / isoToYyMmDd', () => {
  it('ISO 에서 날짜 부분만 뽑는다', () => {
    expect(isoToYyyyMmDd(ISO)).toBe('20260812');
    expect(isoToYyMmDd(ISO)).toBe('260812');
  });

  it('자정 경계에서도 날짜가 밀리지 않는다', () => {
    expect(isoToYyyyMmDd(asIso('2026-08-12T00:00:00+09:00'))).toBe('20260812');
    expect(isoToYyyyMmDd(asIso('2026-08-12T23:59:59+09:00'))).toBe('20260812');
  });

  it('ISO 가 아니면 원본 보존', () => {
    for (const bad of ['', '20260812', '20260812175517', 'not-a-date']) {
      expect(isoToYyyyMmDd(asIso(bad))).toBe(bad);
      expect(isoToYyMmDd(asIso(bad))).toBe(bad);
    }
  });
});

describe('왕복 — 단말 raw → 도메인 ISO → 단말 wire', () => {
  // 이 왕복이 깨지면 취소 요청이 원거래를 못 찾는다 (DaouVP 1094 등).
  it.each([
    ['DaouVP/Kovan 14자리', '20260812175517'],
    ['NICE 12자리', '260812175517'],
  ])('%s', (_name, stamp) => {
    const iso = kstStampToIso(stamp);
    if (iso === null) throw new Error('파싱 가능한 입력이어야 한다');
    expect(isoToYyyyMmDd(iso)).toBe('20260812');
    expect(isoToYyMmDd(iso)).toBe('260812');
  });
});

describe('dateToKstIso', () => {
  it('KST 자릿수로 조립한다 (toISOString 의 UTC Z 와 다름)', () => {
    const d = new Date('2026-08-12T08:55:17.000Z'); // = 17:55:17 KST
    expect(dateToKstIso(d)).toBe(ISO);
    expect(d.toISOString()).not.toBe(dateToKstIso(d)); // 같은 순간, 다른 표기
  });

  it('런타임 로컬 TZ 와 무관하게 결정적', () => {
    const d = new Date(0);
    expect(dateToKstIso(d)).toBe(asIso('1970-01-01T09:00:00+09:00'));
  });
});
