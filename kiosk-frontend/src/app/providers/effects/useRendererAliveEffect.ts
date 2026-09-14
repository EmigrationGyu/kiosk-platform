import { useEffect } from 'react';
import { declareRendererAlive } from '@/shared/update/aliveDeclaration';

/**
 * 첫 커밋 직후 생존을 선언한다 — 렌더러 준비 워치독의 해제 신호.
 *
 * effect 인 이유: 초기 렌더가 던지면 effect 는 아예 돌지 않는다(React 규칙). 그래서 이
 * 선언은 "번들이 평가되고 트리가 실제로 그려졌다"까지를 증언하고, 흰 화면에서만 부재한다.
 * 모듈 평가 시점에 쏘면 마운트 크래시를 놓친다.
 */
export const useRendererAliveEffect = () => {
  useEffect(() => {
    declareRendererAlive();
  }, []);
};
