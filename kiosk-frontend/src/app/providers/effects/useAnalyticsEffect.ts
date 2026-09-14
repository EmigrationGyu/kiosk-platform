import { useEffect } from 'react';
import { identify } from '@/shared/analytics';

/**
 * 계측 신원 부여 — 단말을 식별하되 **사람은 식별하지 않는다.**
 *
 * 원본은 로그인한 키오스크·업장 id 를 붙였다. 그 값은 서버 세션에서 오므로 여기선 뺐고,
 * 붙이는 자리만 남긴다. PII 를 여기 실으면 그 뒤로 모든 이벤트가 오염되므로, 실을 수 있는
 * 차원은 **닫힌 집합**으로 관리한다.
 */
export const useAnalyticsEffect = () => {
  useEffect(() => {
    identify({ surface: 'kiosk-demo' });
  }, []);
};
