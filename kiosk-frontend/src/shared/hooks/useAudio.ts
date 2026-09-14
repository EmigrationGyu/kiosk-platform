import type { AudioKey, AudioVars } from 'kiosk-types';
import { useCallback } from 'react';
import {
  AudioPlayer,
  PLAY_MODE_INTERRUPT,
  type PlayMode,
} from '@/shared/audio/AudioPlayer';
import { resolveAudioClips } from '@/shared/audio/resolveAudioClip';

export type AudioCue = { key: AudioKey; vars?: AudioVars; mode?: PlayMode };

/**
 * 음성 재생의 **단일 관문**. A11yNode·모달 컨테이너·화면이 전부 여기를 지나므로,
 * 변수 누락 경고나 언어 전환 같은 횡단 관심사를 한 곳에서 걸 수 있다.
 *
 * 클립 해소를 기다리지 않고 Promise 를 그대로 넘기는 것이 중요하다 — 플레이어가 호출
 * 순서로 큐를 확정하므로, 자산 도착이 늦거나 순서가 뒤바뀌어도 INTERRUPT·QUEUE 의
 * 논리적 순서가 흔들리지 않는다.
 */
export function useAudio() {
  /**
   * 키 하나 또는 cue 배열. 배열로 부르는 쪽은 모달 중앙 mount 처럼 **여러 조각을 한 호출로**
   * 묶어야 하는 자리다 — 나눠 부르면 자산 해소가 경쟁해 INTERRUPT 가 앞선 조각을 지운다.
   */
  const play = useCallback(
    (
      input: AudioKey | readonly AudioCue[],
      varsOrMode?: AudioVars | PlayMode,
      maybeMode: PlayMode = PLAY_MODE_INTERRUPT,
    ) => {
      const player = AudioPlayer.getInstance();
      if (typeof input === 'string') {
        const vars = typeof varsOrMode === 'object' ? varsOrMode : undefined;
        const mode =
          typeof varsOrMode === 'string' ? (varsOrMode as PlayMode) : maybeMode;
        return player.play(resolveAudioClips(input, vars), mode);
      }
      const mode =
        typeof varsOrMode === 'string' ? (varsOrMode as PlayMode) : maybeMode;
      return player.play(
        Promise.all(input.map((c) => resolveAudioClips(c.key, c.vars))).then(
          (lists) => lists.flat(),
        ),
        mode,
      );
    },
    [],
  );

  const stop = useCallback(() => AudioPlayer.getInstance().stop(), []);

  return { play, stop };
}
