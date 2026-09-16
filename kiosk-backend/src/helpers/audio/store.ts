import path from 'node:path';
import { platform } from '@platform/Platform';
import { createAudioStore } from './core';
import type { AudioStore } from './types';

/**
 * 공용 AudioStore 인스턴스. 환경별로 달랐던 것은 캐시 루트 **문자열 하나**뿐이라
 * 구현을 둘로 나눌 이유가 없다 — 값은 Platform 에서 받고 로직은 core 하나를 쓴다.
 * (core.ts 는 환경을 모른 채로 남아 단위 테스트가 그대로 성립한다.)
 */
export const audioStore: AudioStore = createAudioStore({
  cacheRoot: path.join(platform.paths.userData, 'audio-cache'),
});
