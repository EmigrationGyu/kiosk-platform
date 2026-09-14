import type { AudioKey, AudioVars } from 'kiosk-types';
import type { AudioClip } from './AudioPlayer';

/**
 * 음성 키 → 재생할 클립들.
 *
 * 원본은 백엔드가 키와 변수로 클립 시퀀스를 조립해 돌려줬다(변수 음성은 "객실 301호"처럼
 * 고정 구간 + 값 구간이 섞인다). 데모에는 음성 자산이 없으므로 **빈 목록**을 돌려준다 —
 * 플레이어는 빈 시퀀스를 정상 완료로 처리하고, a11y 배선은 그대로 살아 있다.
 *
 * 자산을 넣으려면 `public/audio/{key}.mp3` 를 두고 아래 한 줄을 바꾸면 된다.
 */
export async function resolveAudioClips(
  _key: AudioKey,
  _vars?: AudioVars,
): Promise<AudioClip[]> {
  return [];
}
