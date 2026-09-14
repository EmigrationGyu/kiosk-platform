import { LANGUAGES, type TolgeeLanguage } from 'kiosk-types';

/** rime 입력 프로파일: 스키마 + 간체화 여부(zh_hans 옵션). */
export type RimeProfile = { schemaId: string; zhHans: boolean };

// 중국어는 단일 스키마 luna_pinyin 을 쓰고 zh_hans 옵션으로 간/번체를 가른다(결정적, 상태 번짐 없음).
// (별도 luna_pinyin_simp 스키마의 저장옵션 번짐 문제를 피함 — zh_hans 는 luna_pinyin 의 simplifier@zh_hans 스위치)
// 일본어는 rime 표준 입력 스키마가 없어 미지원(→ Mozc 경로) → null.
const LUNA_PINYIN = 'luna_pinyin';
const LANGUAGE_PROFILE: Partial<Record<TolgeeLanguage, RimeProfile>> = {
  [LANGUAGES.CN]: { schemaId: LUNA_PINYIN, zhHans: true }, // 간체
  [LANGUAGES.TW]: { schemaId: LUNA_PINYIN, zhHans: false }, // 번체
};

/** 지원 언어면 rime 프로파일, 아니면 null(→ SCHEMA_UNAVAILABLE). */
export function languageToRimeProfile(
  language: TolgeeLanguage,
): RimeProfile | null {
  return LANGUAGE_PROFILE[language] ?? null;
}
