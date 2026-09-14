import { FormatIcu } from '@tolgee/format-icu';
import { Tolgee } from '@tolgee/react';
import { LANGUAGES } from './constants';
import { setDayjsLocaleFromTolgeeLanguage } from './dayjs';
import cn from './messages/cn.json';
import en from './messages/en.json';
import ja from './messages/ja.json';
import ko from './messages/ko.json';
import tw from './messages/tw.json';

/**
 * i18n — **정적 데이터**로 초기화한다.
 *
 * 원본은 번역 SaaS 의 CDN 에서 언어별 JSON 을 받아왔고, 초기 로딩이 실패했을 때
 * 라이브러리의 재요청 경로로는 회복되지 않는 문제를 우회하는 코드가 붙어 있었다
 * (거부된 프라미스가 내부 캐시에 남아 이후 요청이 그걸 재사용한다).
 *
 * 여기선 자산을 번들에 넣어 그 경로 자체를 없앴다. **호출부는 한 줄도 다르지 않다** —
 * `useTranslate()` · `<T>` 가 그대로 동작하고, 언어 전환도 그대로다. 번역이 어디서
 * 오는지는 이 파일만 안다.
 *
 * ICU 포맷터를 쓰는 이유: 복수형·성별·중첩 선택을 문자열 조립으로 처리하면 언어마다
 * 규칙이 달라 반드시 어긋난다(한국어엔 복수형이 없고 러시아어엔 셋이다).
 */
export const tolgee = Tolgee()
  .use(FormatIcu())
  .init({
    language: LANGUAGES.KO,
    defaultLanguage: LANGUAGES.KO,
    fallbackLanguage: LANGUAGES.KO,
    availableLanguages: Object.values(LANGUAGES),
    staticData: {
      [LANGUAGES.KO]: ko,
      [LANGUAGES.EN]: en,
      [LANGUAGES.JA]: ja,
      [LANGUAGES.CN]: cn,
      [LANGUAGES.TW]: tw,
    },
  });

/** 정적 데이터라 회복할 실패가 없다 — 호출부 호환을 위해 남긴다. */
// biome-ignore lint/suspicious/noEmptyBlockStatements: 정적 데이터라 다시 받을 것이 없다 — 빈 본문이 곧 계약
export const reloadTranslations = async (): Promise<void> => {};

// 언어 변경 시 날짜 로케일을 **동기적으로** 맞춘다. React 리렌더보다 먼저 돌아야
// 그 커밋의 모든 포맷 호출이 같은 로케일을 본다.
setDayjsLocaleFromTolgeeLanguage(LANGUAGES.KO);
tolgee.on('language', (e) => {
  setDayjsLocaleFromTolgeeLanguage(e.value);
});
