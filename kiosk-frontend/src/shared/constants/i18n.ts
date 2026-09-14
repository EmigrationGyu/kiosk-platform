// LANGUAGES / TolgeeLanguage 는 kiosk-types 가 단일 진실 공급원.
// (frontend / backend / serialport 모두 동일 정의를 공유해야 IPC 페이로드의
//  lang 코드 검증이 일치한다.)
import {
  LANGUAGES,
  type Language,
  type TolgeeLanguage,
  TolgeeLanguageSchema,
} from 'kiosk-types';

export { LANGUAGES, type Language, type TolgeeLanguage, TolgeeLanguageSchema };

export const CURRENCY = 'CURRENCY';
