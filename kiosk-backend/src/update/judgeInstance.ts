import { bridge } from '@bridge/Bridge';
import { platform } from '@platform/Platform';
import { processManager } from '@processManager/Manager';
import { BRIDGE_METHOD, UPDATE_COMPONENT } from 'kiosk-types';
import { LogService } from 'src/service/LogService';
import { combinationOf } from './generationPath';
import { createPromotionJudge } from './promotionJudge';
import { contractWitness } from './witnessInstance';

/**
 * 프로세스 전역 판정자 — 렌더러의 부팅 완주와 장치의 응답이 각각 여기로 모인다.
 *
 * 싱글턴인 이유: 근거가 도착하는 곳(하드웨어 트랜스포트·업데이트 서비스)이 서로 멀고,
 * 둘을 잇자고 인자를 그 사이 계층에 흘려보낼 이유가 없다.
 */
export const promotionJudge = createPromotionJudge({
  witness: contractWitness,
  allAnswered: () => processManager.allAnswered(),
  currentCombination: () => combinationOf(platform.paths.baseline),
  // 렌더러 완주는 자기 사슬만 보증한다 — 장치를 넣으면 장치 단독 적용이 재선언 계기가
  // 없어 영영 승격되지 않는다.
  rendererChain: () =>
    combinationOf(platform.paths.baseline, [
      UPDATE_COMPONENT.FRONTEND,
      UPDATE_COMPONENT.BACKEND,
    ]),

  onMismatch: (detail) => {
    LogService.getInstance().error(
      '[업데이트] 계약 불일치 — 되감기 요청',
      undefined,
      { unmasked: { detail } },
    );
    void bridge().call(BRIDGE_METHOD.UPDATE_ROLLBACK);
  },

  onPromote: () => {
    LogService.getInstance().info(
      '[업데이트] 부팅 완주 + 계약 일치 + 봉투 전부 회수 — 안정 조합으로 승격 요청',
    );
    void bridge().call(BRIDGE_METHOD.UPDATE_MARK_STABLE);
  },

  onWait: () => {
    LogService.getInstance().info(
      '[업데이트] 부팅 완주 — 아직 답하지 않은 서브프로세스가 있어 기다립니다',
    );
  },
});
