import { useTolgee } from '@tolgee/react';
import { useEffect, useState } from 'react';
import type { TolgeeLanguage } from '@/shared/constants/i18n';

/**
 * Tolgee 언어 변경에 반응형으로 동작하는 훅
 * useTolgee(['language'])가 리렌더링을 트리거하지 않는 문제를 해결
 *
 * @example
 * const language = useReactiveLanguage();
 * // language 값이 변경되면 컴포넌트가 리렌더링됨
 */
export const useReactiveLanguage = () => {
  const tolgee = useTolgee();
  const [language, setLanguage] = useState<TolgeeLanguage>(
    () => tolgee.getLanguage() as TolgeeLanguage,
  );

  useEffect(() => {
    // Tolgee 언어 변경 이벤트 구독
    const subscription = tolgee.on('language', (e) => {
      setLanguage(e.value as TolgeeLanguage);
    });

    return () => subscription.unsubscribe();
  }, [tolgee]);

  return language;
};
