import { platform } from '@platform/Platform';
import { APPLY_OUTCOME } from 'kiosk-types';
import { LogService } from 'src/service/LogService';
import { applyManifest, reportApply } from './applyManifest';
import { readPointer } from './generationPath';
import {
  clearRollbackIntent,
  readRollbackIntent,
  readRollbackStack,
  writeRollbackIntent,
} from './rollbackFiles';
import { planResume, planRollback } from './rollbackPlan';

/**
 * "직전 조합으로" — 목적지는 서버가 아니라 되돌림 스택이 안다.
 *
 * 풀고 나면 평범한 적용이다: 받기 → 정숙 → 잠금 → 부모 적용 → 판정 → 기록. 다른 것은
 * `kind` 뿐이고, 그것으로 부모가 스택을 push 대신 pop 한다.
 */
export async function rollback(input: {
  /** 하네스처럼 서버 지시가 아니면 null. */
  commandId: string | null;
}): Promise<void> {
  const logger = LogService.getInstance();
  const plan = planRollback({
    stack: readRollbackStack(),
    live: readPointer(platform.paths.baseline),
    appVersion: platform.appVersion,
    commandId: input.commandId,
  });

  if (plan.kind === 'decline') {
    logger.info('[업데이트] 롤백 거절', {
      unmasked: { detail: plan.detail },
    });
    reportApply({
      commandId: input.commandId,
      // 롤백은 서버 배포 행에서 오지 않는다 — 되돌아갈 곳은 로컬 스택이 안다.
      deploymentIds: {},
      requested: {},
      requestedBase: null,
      outcome: APPLY_OUTCOME.DECLINED,
      detail: plan.detail,
    });
    return;
  }

  if (plan.kind === 'reinstall') {
    logger.info('[업데이트] 롤백 — 설치본을 먼저 깝니다', {
      unmasked: { base: plan.intent.target.base },
    });
    writeRollbackIntent(plan.intent);
  } else {
    logger.info('[업데이트] 롤백 — 직전 조합으로 돌아갑니다');
  }

  await applyManifest({
    commandId: input.commandId,
    deploymentIds: {},
    manifest: plan.manifest,
    kind: 'rollback',
  });
}

/**
 * 설치본을 넘은 롤백의 나머지 절반 — 다시 뜬 백엔드가 부팅 때 한 번 본다.
 *
 * 렌더러의 "안전한 화면" 판단은 건너뛴다. 부팅 직후라 손님이 없고, 정숙 대기는
 * 적용 경로가 그대로 한다.
 */
export function resumeRollback(): void {
  const intent = readRollbackIntent();
  if (intent === null) return;
  clearRollbackIntent();

  const logger = LogService.getInstance();
  const manifest = planResume({
    intent,
    live: readPointer(platform.paths.baseline),
    appVersion: platform.appVersion,
  });
  if (manifest === null) {
    logger.error(
      '[업데이트] 롤백 intent 폐기 — 설치본이 intent 의 대상과 다릅니다',
      undefined,
      { unmasked: { expectedBase: intent.target.base } },
    );
    return;
  }

  logger.info('[업데이트] 롤백 이어서 — 컴포넌트를 되돌립니다');
  void applyManifest({
    commandId: intent.commandId,
    deploymentIds: {},
    manifest,
    kind: 'rollback',
  }).catch((error: unknown) =>
    logger.error('[업데이트] 롤백 이어가기 실패', error),
  );
}
