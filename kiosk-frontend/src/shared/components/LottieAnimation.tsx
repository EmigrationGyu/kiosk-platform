import Lottie, { type LottieRefCurrentProps } from 'lottie-react';
import { useEffect, useRef } from 'react';
import { LANGUAGES, type TolgeeLanguage } from '@/shared/constants/i18n';
import { useConst } from '@/shared/hooks/useConst';
import { useReactiveLanguage } from '@/shared/hooks/useReactiveLanguage';
import { Logger } from '@/shared/logger/Logger';

interface LottieAnimationProps {
  /**
   * Lottie JSON 애니메이션 데이터.
   *
   * `null` 은 `useLottie` 의 **지연 로딩 중** 상태이고, `undefined` 는 호출자가 데이터를 아예
   * 넘기지 않은 것이다 — 아래에서 둘을 갈라 전자는 조용히 비우고 후자만 에러로 남긴다.
   */
  animationData?: unknown;
  /** 언어별 애니메이션 데이터 객체 */
  animationDataByLanguage?: {
    [key in TolgeeLanguage]?: unknown;
  };
  /** 반복 재생 여부 (기본값: true) */
  loop?: boolean;
  /** 자동 재생 여부 (기본값: true) */
  autoplay?: boolean;
  /** css class 이름 */
  className?: string;
  onComplete?: () => void;
  /** 재생 속도 배율 (1 = 기본, 2 = 2배속). 기본값 2 */
  speed?: number;
}

export const LottieAnimation = ({
  animationData,
  animationDataByLanguage,
  loop = true,
  autoplay = true,
  className,
  onComplete,
  speed = 1.75,
}: LottieAnimationProps) => {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);
  const currentLanguage = useReactiveLanguage();
  const logger = useConst(() => new Logger());
  const currentAnimationData = animationDataByLanguage
    ? animationDataByLanguage?.[currentLanguage] ||
      animationDataByLanguage?.[LANGUAGES.KO] ||
      Object.values(animationDataByLanguage)[0]
    : animationData;

  // 로드/데이터 변경 후 재생 속도 재적용. animationData 가 바뀌면 애니메이션이
  // 재생성되며 speed 가 1 로 리셋되므로 currentAnimationData 도 deps 에 포함한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentAnimationData 는 effect 본문에서 읽지 않지만 재실행 트리거로 필요하다 — 빼면 애니메이션 교체 후 speed 가 1 에 머문다
  useEffect(() => {
    lottieRef.current?.setSpeed(speed);
  }, [speed, currentAnimationData]);

  // 지연 로딩 중(useLottie 가 청크 평가 전에 돌려주는 null) — 정상 상태이므로 조용히 비운다.
  // 데이터가 도착하면 리렌더로 이어붙는다. `undefined`(미전달)만 계속 에러로 남긴다.
  if (currentAnimationData === null) {
    return null;
  }

  if (!currentAnimationData) {
    logger.error('LottieAnimation: 애니메이션 데이터가 제공되지 않았습니다.');
    return null;
  }

  return (
    <Lottie
      lottieRef={lottieRef}
      animationData={currentAnimationData}
      loop={loop}
      autoplay={autoplay}
      className={className}
      onComplete={onComplete}
    />
  );
};

export default LottieAnimation;
