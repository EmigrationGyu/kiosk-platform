import { useEffect, useRef } from 'react';
import { AudioPlayer } from '@/shared/audio/AudioPlayer';
import { useReactiveLanguage } from '@/shared/hooks/useReactiveLanguage';

/**
 * 전역 언어 변경 시 재생 중인(이전 언어) 음성을 중단한다.
 *
 * 언어는 푸터·모달 등 여러 곳에서 바꾸므로
 * 단일 호출부에 거는 대신, 여기서 reactive 언어를 감시해 한 곳에서 끊는다.
 * 초기 마운트는 스킵 — 진입 화면의 첫 안내(예: 홈 인사말)를 죽이지 않기 위해.
 */
export function useStopAudioOnLanguageChange() {
  const language = useReactiveLanguage();
  const isFirst = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: language 변경 시마다 AudioPlayer.getInstance().stop() 호출. getInstance는 싱글톤이므로 의존성에 추가하지 않음.
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    AudioPlayer.getInstance().stop();
  }, [language]);
}
