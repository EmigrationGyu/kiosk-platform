import type { DeploymentIdMap, Manifest } from 'kiosk-types';

/**
 * 원격 부분 업데이트 — 서버 → 키오스크로 push 되는 적용·롤백 지시.
 *
 * 원격 키 발급과 **같은 채널·같은 봉투**를 탄다(`sendKioskControlPacket` →
 * kioskSystemSubscription, type='KIOSK_CONTROL'). 실제 커맨드는 payload 의 controlType
 * 으로 갈리므로, 업데이트를 위해 서버에 새로 만들 것이 없다.
 *
 * 이 타입은 wire payload 를 정규화한 안정 계약이다 — 구독 채널이 바뀌어도 큐·드레인은
 * 이것만 바라본다.
 */

/** payload.controlType — 커맨드 판별자 */
export const APPLY_UPDATE_CONTROL = 'applyUpdate';
/** 목적지 없이 온다 — 어디로 돌아갈지는 키오스크의 되돌림 스택이 안다. */
export const ROLLBACK_UPDATE_CONTROL = 'rollbackUpdate';

export type UpdateCommand = {
  /** 멱등/중복제거 키이자 결과 보고의 상관 키 — 서버 알림 id(= 발송의 batchId) */
  commandId: string;
} & (
  | {
      action: 'apply';
      manifest: Manifest;
      /**
       * 도메인 → 서버 배포 행 id. 결과를 행 단위로 되돌려보낼 좌표다.
       *
       * 서버는 (키오스크, 도메인)마다 행을 만들고 키오스크는 조합으로 접어 적용하므로,
       * 접기 전의 좌표가 여기서부터 적용 기록까지 따라간다. 빈 맵 = 서버 배포가 아닌
       * 경로(옛 `KIOSK_CONTROL/applyUpdate`·하네스).
       */
      deploymentIds: DeploymentIdMap;
    }
  | { action: 'rollback' }
);
