import type { TolgeeLanguage } from 'kiosk-types';

/**
 * AudioStore 인터페이스
 *
 * 구현은 core.ts 하나이고, 캐시 루트만 Platform 에서 받습니다 (store.ts 참고).
 *
 * ETag 조건부 GET 으로 캐시 신선도를 유지하며,
 * 네트워크 실패 시 캐시된 사본으로 graceful 하게 폴백합니다.
 */
export interface AudioStore {
  /**
   * (lang, key) 음성 클립의 mp3 바이트를 반환합니다.
   *
   * - CDN URL: `${AUDIO_CDN_BASE_URL}/{lang}/{key}.mp3`
   * - 캐시 경로: `{cacheRoot}/{lang}/{key}.mp3`
   *
   * `lang` 은 Tolgee 언어 코드(`TolgeeLanguage`), `key` 는 i18n 키값과 통일됩니다.
   */
  getClip(lang: TolgeeLanguage, key: string): Promise<Uint8Array>;
}
