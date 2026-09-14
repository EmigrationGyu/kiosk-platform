import { useTranslate } from '@tolgee/react';
import { A11Y_KEYS } from 'kiosk-types';
import { useState } from 'react';
import { A11yNode } from '@/shared/a11y';
import { KeyboardTextInput } from '@/shared/components/keyboard/KeyboardTextInput';
import { KEYBOARD_TYPE } from '@/shared/constants/keyboard';
import { useReactiveLanguage } from '@/shared/hooks';

/**
 * 입력기 데모 — 한 화면이 전 스택을 관통한다.
 *
 *   키 입력 → editOps(순수) → Transport → IPC → 서브프로세스 → koffi → 실제 엔진 → 후보
 *
 * 언어 셀렉터 하나가 UI 문구와 엔진을 **동시에** 바꾼다. 엔진은 언어를 모르고 스키마가
 * 언어를 가르므로, 중국어/일본어 전환이 엔진 교체가 아니라 데이터 교체가 된다.
 */
const ImeDemo = () => {
  const [value, setValue] = useState('');
  const language = useReactiveLanguage();
  const { t } = useTranslate();

  return (
    <A11yNode a11yKey={A11Y_KEYS.DEMO_IME_PAGE}>
      <div className="flex h-full flex-col gap-space-6 px-space-10 pt-space-16">
        <p className="typo-t1-b text-glyph-gray-heading">
          {t('demo.home.ime')}
        </p>
        {/* 파라미터 이름이 `language` 면 Tolgee 가 ICU 인자가 아니라 "이 언어로 렌더"
            옵션으로 먹어, 인자가 안 채워진 채 포맷돼 'invalid' 만 남는다. */}
        <p className="typo-b3-r text-glyph-gray-description">
          {t('demo.ime.hint', { lang: language })}
        </p>
        <A11yNode a11yKey={A11Y_KEYS.DEMO_IME_INPUT}>
          <KeyboardTextInput
            keyboardType={KEYBOARD_TYPE.TEXT}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('demo.ime.placeholder')}
          />
        </A11yNode>
        <div className="rounded-[10px] bg-background-base-elevate p-space-6">
          <p className="typo-b3-m text-glyph-gray-description">
            {t('demo.ime.committed')}
          </p>
          <p className="typo-b1-sb text-glyph-gray-body break-all">
            {value || '—'}
          </p>
        </div>
      </div>
    </A11yNode>
  );
};

export default ImeDemo;
