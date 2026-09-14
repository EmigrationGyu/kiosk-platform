import {
  DeploymentCommandSchema,
  type DeploymentIdMap,
  normalizeDeployment,
} from 'kiosk-types';
import { Logger } from '@/shared/logger/Logger';
import type { UpdateCommand } from './types';

/**
 * 서버 배포 지시(`DEPLOYMENT`) 경계 파싱.
 *
 * 서버는 (키오스크, 도메인)마다 행 하나를 보내고 키오스크는 조합을 통째로 적용하므로,
 * 받는 자리에서 행 묶음을 매니페스트 하나로 접는다.
 *
 * **거절을 null 과 구분한다.** 접다가 거절된 것은 "시킨 일이 일어나지 않았다"는 결론이라
 * 서버에 FAILED 로 보고해야 하고, 보고하려면 어느 행이었는지가 필요하다. payload 자체가
 * 말이 안 되는 경우에만 좌표가 없어 아무것도 못 한다.
 */
export type ParsedDeployment =
  | { kind: 'command'; command: UpdateCommand }
  | { kind: 'rejected'; ids: DeploymentIdMap; reason: string }
  | null;

export function parseDeploymentCommand(raw: string | null): ParsedDeployment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '{}');
  } catch (error) {
    new Logger().error('[업데이트] 배포 payload 파싱 실패', error as Error);
    return null;
  }

  const payload = DeploymentCommandSchema.safeParse(parsed);
  if (!payload.success) {
    new Logger().error('[업데이트] 배포 payload 형식 오류 — 무시합니다');
    return null;
  }

  const folded = normalizeDeployment(payload.data.deployments);
  if (!folded.ok) {
    return { kind: 'rejected', ids: folded.ids, reason: folded.reason };
  }

  return {
    kind: 'command',
    command: {
      // 발송이 곧 지시의 단위다 — 결과 기록도 이 id 로 맞댄다.
      commandId: payload.data.batchId,
      action: 'apply',
      manifest: folded.manifest,
      deploymentIds: folded.ids,
    },
  };
}
