import { useApolloClient } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { deriveFlow, type Flow } from '@/shared/analytics';
import { evictGuestSessionCache } from '@/shared/api/evictGuestSessionCache';
import { Logger } from '@/shared/logger/Logger';

/**
 * 세션 종료(플로우 → 홈 영역 복귀) 시 게스트 스코프 Apollo 캐시 수거.
 *
 * 떠나는 쪽(goHome)이 아니라 도착한 쪽에서 걷는 이유: navigate 직후에는 이전
 * 페이지의 useFragment 구독이 아직 마운트돼 있어, evict 를 관찰하면 unmount 전에
 * incomplete 로 재렌더/throw 할 수 있다(홈 복귀 시 언어 초기화 깜빡임과 같은
 * 타이밍 race). effect 는 홈 트리 커밋 이후에 실행되므로 이전 플로우 트리의
 * unmount 가 React 커밋 순서로 보장된다. 홈 영역 화면은 예약 데이터를 읽지
 * 않으므로 수거는 어떤 재렌더도 일으키지 않는다.
 *
 * goHome 경유 여부와 무관하게 홈 복귀라는 상태 전이 자체에 걸리므로,
 * 모든 세션 종료 경로(수동 홈·idle·플로우 완주)를 한 지점에서 커버한다.
 * 환불 분기(flow=refund)는 같은 게스트의 연장이라 수거되지 않는다.
 */
export const useGuestSessionCacheCleanupEffect = () => {
  const { pathname } = useLocation();
  const apolloClient = useApolloClient();
  const prevFlowRef = useRef<Flow | null>(null);

  useEffect(() => {
    const flow = deriveFlow(pathname);
    const prevFlow = prevFlowRef.current;
    prevFlowRef.current = flow;
    // 비홈 → 홈 전이 = 세션 종료. (최초 마운트·홈 내부 이동은 수거할 게 없다)
    if (flow !== 'home' || prevFlow === 'home' || prevFlow === null) return;

    const evicted = evictGuestSessionCache(apolloClient.cache);
    if (evicted.length > 0) {
      new Logger().info(
        `[세션] 게스트 스코프 캐시 수거 ${evicted.length}건 (${prevFlow} → home)`,
      );
    }
  }, [pathname, apolloClient]);
};
