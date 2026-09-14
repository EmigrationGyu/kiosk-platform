import { describe, expect, it } from 'bun:test';
import { formatClockTime, formatDuration } from './time-reading';

// 고정 TZ 로 결정성 확보(런타임 로컬 TZ 에 흔들리지 않게). Asia/Seoul = UTC+9.
const KST = 'Asia/Seoul';
// UTC 기준으로 만들어 KST 로 읽으면 표의 현지시각이 된다.
const at = (utcHour: number, utcMin = 0) =>
  Date.UTC(2024, 0, 1, utcHour, utcMin);

describe('formatClockTime (ko-KR)', () => {
  it('11:30 → 오전 열한 시 삼십 분', () => {
    expect(formatClockTime(at(2, 30), 'ko-KR', KST)).toBe(
      '오전 열한 시 삼십 분',
    );
  });
  it('정각(분=0)은 분 생략 — 15:00 → 오후 세 시', () => {
    expect(formatClockTime(at(6, 0), 'ko-KR', KST)).toBe('오후 세 시');
  });
  it('자정 00:00 → 오전 열두 시', () => {
    expect(formatClockTime(at(15, 0), 'ko-KR', KST)).toBe('오전 열두 시');
  });
  it('정오 12:00 → 오후 열두 시', () => {
    expect(formatClockTime(at(3, 0), 'ko-KR', KST)).toBe('오후 열두 시');
  });
  it('09:05 → 오전 아홉 시 오 분 (분 한 자리)', () => {
    expect(formatClockTime(at(0, 5), 'ko-KR', KST)).toBe('오전 아홉 시 오 분');
  });
});

describe('formatClockTime (기타 언어 — Intl, 느슨 검증)', () => {
  // Intl 은 ICU 버전에 따라 AM 앞 공백이 NBSP 일 수 있어 정확 일치 대신 포함으로 본다.
  it('en-US 11:30 은 "11:30" + AM 을 포함', () => {
    const out = formatClockTime(at(2, 30), 'en-US', KST);
    expect(out).toContain('11:30');
    expect(out).toMatch(/AM/i);
  });
  it('ja-JP 11:30 은 "11:30" 을 포함', () => {
    expect(formatClockTime(at(2, 30), 'ja-JP', KST)).toContain('11:30');
  });
});

describe('formatDuration', () => {
  it('ko: 시간+분 / 분만 / 시간만 / 단수', () => {
    expect(formatDuration(150, 'ko-KR')).toBe('두 시간 삼십 분');
    expect(formatDuration(30, 'ko-KR')).toBe('삼십 분');
    expect(formatDuration(120, 'ko-KR')).toBe('두 시간');
    expect(formatDuration(61, 'ko-KR')).toBe('한 시간 일 분');
  });
  it('en: 복수/단수 처리', () => {
    expect(formatDuration(150, 'en-US')).toBe('2 hours 30 minutes');
    expect(formatDuration(30, 'en-US')).toBe('30 minutes');
    expect(formatDuration(120, 'en-US')).toBe('2 hours');
    expect(formatDuration(61, 'en-US')).toBe('1 hour 1 minute');
  });
  it('ja/zh/zh-Hant 템플릿', () => {
    expect(formatDuration(150, 'ja-JP')).toBe('2時間30分');
    expect(formatDuration(30, 'ja-JP')).toBe('30分');
    expect(formatDuration(150, 'zh')).toBe('2小时30分钟');
    expect(formatDuration(150, 'zh-Hant-TW')).toBe('2小時30分鐘');
  });
  it('음수/소수 방어 — 0 이상 정수로', () => {
    expect(formatDuration(-5, 'en-US')).toBe('0 minutes');
    expect(formatDuration(29.6, 'en-US')).toBe('30 minutes');
  });
});
