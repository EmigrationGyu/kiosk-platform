import { useHardwareScan } from '@/app/providers/effects/useHardwareScan';
import { DEVICE_IDS, type DeviceId } from '@/shared/constants/events/Hardware';
import { useAnalyticsEffect } from './useAnalyticsEffect';
import { useGuestSessionCacheCleanupEffect } from './useGuestSessionCacheCleanupEffect';
import { useIdleEffect } from './useIdleEffect';
import { usePageModalLogEffect } from './usePageModalLogEffect';
import { useRendererAliveEffect } from './useRendererAliveEffect';
import { useStopAudioOnLanguageChange } from './useStopAudioOnLanguageChange';

const SCAN_DEVICES: DeviceId[] = [DEVICE_IDS.TOKEN_DISPENSER];

/**
 * 화면과 무관하게 항상 살아 있어야 하는 효과들의 **한 자리**.
 *
 * 페이지에 흩뿌리면 그 페이지를 안 지나는 경로에서 조용히 빠진다. 계측·로그·idle·
 * 생존 선언처럼 "어느 화면이든 해당되는" 것은 전부 여기 모인다.
 */
const GlobalEffects = () => {
  // 첫 커밋 직후 생존 선언 — 렌더러 준비 워치독 해제. 다른 효과와 순서가 무관하다.
  useRendererAliveEffect();
  useAnalyticsEffect();
  usePageModalLogEffect();
  useHardwareScan(SCAN_DEVICES);
  useStopAudioOnLanguageChange();
  // 무동작 경고 → 유예 → 홈 복귀. 순수 시간축(idleStream)의 유일한 구독 지점.
  useIdleEffect();
  // 세션 종료(비홈 → 홈 전이) 시 게스트 스코프 캐시 수거
  useGuestSessionCacheCleanupEffect();

  return null;
};

export default GlobalEffects;
