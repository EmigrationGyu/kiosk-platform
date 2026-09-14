import { describe, expect, it } from 'bun:test';
import { LANGUAGES } from 'kiosk-types';
import { languageToRimeProfile } from './schema';

describe('languageToRimeProfile', () => {
  it('간체(CN) → luna_pinyin + zh_hans on', () => {
    expect(languageToRimeProfile(LANGUAGES.CN)).toEqual({
      schemaId: 'luna_pinyin',
      zhHans: true,
    });
  });

  it('번체(TW) → luna_pinyin + zh_hans off', () => {
    expect(languageToRimeProfile(LANGUAGES.TW)).toEqual({
      schemaId: 'luna_pinyin',
      zhHans: false,
    });
  });

  it('비-CJK / 미지원 언어는 null (→ SCHEMA_UNAVAILABLE)', () => {
    expect(languageToRimeProfile(LANGUAGES.KO)).toBeNull();
    expect(languageToRimeProfile(LANGUAGES.EN)).toBeNull();
    expect(languageToRimeProfile(LANGUAGES.JA)).toBeNull(); // 일본어 = Mozc 경로
  });
});
