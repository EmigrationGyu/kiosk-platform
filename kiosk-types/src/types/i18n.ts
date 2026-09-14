import { z } from 'zod';

// 키오스크가 노출하는 UI 언어 — Tolgee 언어 코드와 1:1 매핑.
// 이 모듈이 frontend / backend / serialport 모두의 단일 진실 공급원.
export const LANGUAGES = {
  KO: 'ko-KR',
  EN: 'en-US',
  JA: 'ja-JP',
  CN: 'zh',
  TW: 'zh-Hant-TW',
} as const;

export type Language = keyof typeof LANGUAGES;
export type TolgeeLanguage = (typeof LANGUAGES)[Language];

const TOLGEE_LANGUAGE_VALUES = Object.values(LANGUAGES) as [
  TolgeeLanguage,
  ...TolgeeLanguage[],
];

export const TolgeeLanguageSchema = z.enum(TOLGEE_LANGUAGE_VALUES);
