import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { deriveFlow } from '@/shared/analytics';
import { useConst } from '@/shared/hooks/useConst';
import { useModalStore } from '@/shared/lib/modal/store';
import { Logger } from '@/shared/logger/Logger';

/**
 * 로컬 운영 로그용 진입 트레일 — 페이지(라우트)와 모달의 "진입"을 백엔드 파일 로그로 남긴다.
 *
 * PostHog 의 `useAnalyticsEffect`(screen_viewed) 와 트리거는 같지만 관심사가 다르다:
 * - PostHog = 제품 분석/퍼널 (집계, production 전용)
 * - 여기 = 키오스크별 운영/장애 트레일 (하드웨어·뮤테이션 로그와 한 줄에 섞여 읽힘,
 *   dev/non-prod 에서도 남는다)
 *
 * 진입 시점만 기록한다(체류·이탈은 PostHog 담당). 모달 props 는 덤프하지 않고 타입만.
 * MainLayout 하위 GlobalEffects 에서 단일 mount — 라우터/모달 컨텍스트 안.
 */
export function usePageModalLogEffect() {
  const logger = useConst(() => new Logger());
  const location = useLocation();
  const modalList = useModalStore((s) => s.modalList);

  const prevPathRef = useRef<string | null>(null);
  const prevModalLenRef = useRef(0);
  const prevModalTopRef = useRef<string | null>(null);

  // 페이지(라우트) 진입
  useEffect(() => {
    const step = location.pathname;
    if (step === prevPathRef.current) return;
    prevPathRef.current = step;
    logger.info(`[화면] 페이지 진입 step=${step} flow=${deriveFlow(step)}`);
  }, [location.pathname, logger]);

  // 모달 진입 — modalList 가 늘어났거나(open), 길이 같고 top 이 바뀌면(replace) 기록.
  // 닫힘으로 이전 모달이 드러나는 경우(shrink)는 진입이 아니므로 제외.
  useEffect(() => {
    const len = modalList.length;
    const top = len > 0 ? modalList[len - 1].modalType : null;
    const opened =
      len > prevModalLenRef.current ||
      (len === prevModalLenRef.current &&
        len > 0 &&
        top !== prevModalTopRef.current);
    prevModalLenRef.current = len;
    prevModalTopRef.current = top;
    if (opened && top) {
      logger.info(`[화면] 모달 진입 모달=${top}`);
    }
  }, [modalList, logger]);
}
