import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import 'dayjs/locale/ko';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/zh-tw';
import { LANGUAGES } from './constants';
import type { TolgeeLanguage } from './types';

const DAYJS_LOCALE_BY_LANGUAGE: Record<TolgeeLanguage, string> = {
  'ko-KR': 'ko',
  'en-US': 'en',
  'ja-JP': 'ja',
  zh: 'zh-cn',
  'zh-Hant-TW': 'zh-tw',
} as const;

export function setDayjsLocaleFromTolgeeLanguage(language: string | undefined) {
  const safeLanguage = language ?? LANGUAGES.KO;
  const dayjsLocale =
    DAYJS_LOCALE_BY_LANGUAGE[safeLanguage as TolgeeLanguage] ?? 'en';
  dayjs.locale(dayjsLocale);
}

// dayjs 인스턴스는 생성 시점의 locale을 캡처하므로,
// 언어 변경 후에도 기존 인스턴스의 format()이 이전 locale을 사용하는 문제가 있음.
// format() 호출 시 항상 현재 전역 locale을 사용하도록 오버라이드.
const originalFormat = dayjs.prototype.format;
dayjs.prototype.format = function (template?: string) {
  return originalFormat.call(this.locale(dayjs.locale()), template);
};
