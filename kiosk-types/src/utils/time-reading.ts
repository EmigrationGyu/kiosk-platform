import type { TolgeeLanguage } from '../types/i18n';
import { readNumberWithCounter } from './korean-reading';

/**
 * 시간/지속시간 변수 → 언어별 발화 문자열. 백엔드 `renderVar` 가 원시값(Unix ms / 분)을 받아 이
 * 함수로 발화를 만들고, 그 문자열이 곧 `_var/{time|duration}/{발화}` 클립 키가 된다 — 원시
 * 타임스탬프를 키로 쓰면 초마다 유니크해져 캐시가 터지므로 반드시 포맷 후 키를 만든다.
 *
 * ko 는 숫자를 한자어로만 읽는 TTS 오독을 피하려고 `readNumberWithCounter` 로 시/분을 정규화한다.
 */

/** 지정 TZ(기본 런타임 로컬) 기준 24시간제 시/분 추출 — getHours 는 런타임 TZ 라 비결정적이라 Intl 사용. */
function clockParts(
  date: Date,
  timeZone: string | undefined,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { hour: get('hour'), minute: get('minute') };
}

/**
 * 시각(moment) → 언어별 발화. 값은 Unix ms. 정각(분=0)은 분을 생략한다. `timeZone` 은 업장 현지
 * 시각으로 읽기 위한 것 — 기본값(런타임 로컬)은 키오스크가 현지에 있으므로 곧 업장 TZ 다.
 *
 * 예: ko 11:30 → "오전 열한 시 삼십 분" · en → "11:30 AM" · ja → "11:30".
 */
export function formatClockTime(
  unixMs: number,
  lang: TolgeeLanguage,
  timeZone?: string,
): string {
  const date = new Date(unixMs);
  if (lang === 'ko-KR') {
    const { hour, minute } = clockParts(date, timeZone);
    const meridiem = hour < 12 ? '오전' : '오후';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    const out = [meridiem, readNumberWithCounter(hour12, '시')];
    if (minute > 0) out.push(readNumberWithCounter(minute, '분'));
    return out.join(' ');
  }
  return new Intl.DateTimeFormat(lang, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/**
 * 지속시간 → 언어별 발화. 값은 정수 분(minutes). Intl 은 duration 을 못 다루므로 언어별 템플릿.
 * 0 처리: 시간>0·분=0 이면 분 생략("두 시간"), 시간=0 이면 분만("삼십 분").
 *
 * 예: 150분 → ko "두 시간 삼십 분" · en "2 hours 30 minutes" · ja "2時間30分" · zh "2小时30分钟".
 */
export function formatDuration(minutes: number, lang: TolgeeLanguage): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const showMinutes = m > 0 || h === 0; // 시간만 있으면 분 생략, 둘 다 0 이면 "0분"

  switch (lang) {
    case 'ko-KR': {
      const parts: string[] = [];
      if (h > 0) parts.push(readNumberWithCounter(h, '시간'));
      if (showMinutes) parts.push(readNumberWithCounter(m, '분'));
      return parts.join(' ');
    }
    case 'ja-JP': {
      const parts: string[] = [];
      if (h > 0) parts.push(`${h}時間`);
      if (showMinutes) parts.push(`${m}分`);
      return parts.join('');
    }
    case 'zh':
    case 'zh-Hant-TW': {
      const [hourWord, minWord] =
        lang === 'zh' ? ['小时', '分钟'] : ['小時', '分鐘'];
      const parts: string[] = [];
      if (h > 0) parts.push(`${h}${hourWord}`);
      if (showMinutes) parts.push(`${m}${minWord}`);
      return parts.join('');
    }
    default: {
      // en-US
      const parts: string[] = [];
      if (h > 0) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
      if (showMinutes) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
      return parts.join(' ');
    }
  }
}
