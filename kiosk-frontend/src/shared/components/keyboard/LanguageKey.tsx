import { useTolgee } from '@tolgee/react';
import { useState } from 'react';
import { LANGUAGES, type TolgeeLanguage } from '@/shared/constants/i18n';
import { useKeyboardStore } from '@/shared/lib/keyboard/store';
import {
  KEY_CLICK_VARIANTS,
  playKeyClick,
} from '@/shared/lib/keyClick/keyClick';
import { Icon, Pressable } from '@/shared/ui';
import { ic_globe } from '@/shared/ui/icons';
import SpecialKey from './SpecialKey';

// 라벨 ↔ 언어 코드. 简=CN(ZhCn), 繁=TW(ZhTw) — kioskLanguageToTolgee 기준.
const LANGUAGE_OPTIONS: { label: string; language: TolgeeLanguage }[] = [
  { label: 'KOR', language: LANGUAGES.KO },
  { label: 'ENG', language: LANGUAGES.EN },
  { label: '中文 简', language: LANGUAGES.CN },
  { label: '中文 繁', language: LANGUAGES.TW },
  { label: '日本語', language: LANGUAGES.JA },
];

const LanguageKey = () => {
  const [openLanguageList, setOpenLanguageList] = useState(false);
  const setKeyboardLanguage = useKeyboardStore((s) => s.setKeyboardLanguage);
  const tolgee = useTolgee();

  const selectLanguage = async (language: TolgeeLanguage) => {
    // 키 글리프는 t(key, { language }) 오버라이드로 그리는데, 이 오버라이드는 해당 언어
    // 리소스가 캐시에 있을 때만 동작한다. 커밋 전에 로드를 보장해, 첫 선택에서도 현재
    // 언어로 폴백되는 플래시 없이 즉시 전환되게 한다(로드 실패 시엔 그냥 전환 —
    // KeyboardContainer 의 loadRequired effect 가 폴백으로 재시도).
    await tolgee.loadRequired({ language, useCache: true }).catch(() => null);
    setKeyboardLanguage(language);
    setOpenLanguageList(false);
  };

  return (
    <>
      <SpecialKey
        width="61px"
        content={<Icon icon={ic_globe} size={24} />}
        onKeyPress={() => {
          setOpenLanguageList(true);
        }}
      />

      {openLanguageList && (
        <div className="absolute bottom-0 flex flex-col items-center w-[61px] py-space-2 bg-white rounded-[6px] shadow-[0_1px_0_0.25px_var(--v-background-base-focus)]">
          <div className="absolute top-0 w-full h-full py-space-4 bg-background-base-focus rounded-[6px]" />
          {LANGUAGE_OPTIONS.map(({ label, language }) => (
            <Pressable
              key={language}
              className="flex items-center justify-center w-full h-full py-space-2"
              onPress={() => {
                playKeyClick(KEY_CLICK_VARIANTS.MODIFIER);
                void selectLanguage(language);
              }}
            >
              <span className="text-glyph-gray-body typo-b2-sb text-center">
                {label}
              </span>
            </Pressable>
          ))}
        </div>
      )}
    </>
  );
};

export default LanguageKey;
