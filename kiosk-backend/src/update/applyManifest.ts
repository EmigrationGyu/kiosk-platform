import { bridge } from '@bridge/Bridge';
import { platform } from '@platform/Platform';
import { processManager } from '@processManager/Manager';
import {
  APPLY_OUTCOME,
  type ApplyInstruction,
  type ApplyReport,
  BRIDGE_METHOD,
  type Manifest,
  SERIALPORT_PROCESS,
} from 'kiosk-types';
import { LogService } from 'src/service/LogService';
import { artifactFetcher } from './fetcherInstance';
import { promotionJudge } from './judgeInstance';
import { createSerialQueue } from './serialize';
import { updateGate } from './updateGate';

/**
 * 결과를 부모에게 넘긴다 — 기록을 쓰는 것은 부모뿐이다.
 *
 * 여기서 끝나는 결과는 부모가 볼 방법이 없다. 넘기지 않으면 로그에만 남고, 서버로 나가는
 * 표면에서 사라진다.
 */
export const reportApply = (entry: ApplyReport): void => {
  // 넘기기 실패가 진짜 원인을 덮으면 안 된다 — 기록은 전달이고 사실이 아니다. 부모 쪽
  // record() 가 쓰기 실패를 삼키는 것과 같은 이유다(기록이 복구를 막지 않는다).
  void bridge()
    .call(BRIDGE_METHOD.UPDATE_RECORD, entry)
    .catch((error: unknown) =>
      LogService.getInstance().error(
        '[업데이트] 결과를 넘기지 못했습니다',
        error,
      ),
    );
};

/**
 * 산출물을 확보한다. 실패는 **남기고 그대로 던진다** — 부모에 닿기 전에 끝나는 결과라
 * 여기서 넘기지 않으면 아무 데도 남지 않는다(서명 검증 실패가 그렇다).
 */
async function ensureArtifacts(instruction: {
  commandId: string | null;
  deploymentIds: Record<string, string>;
  manifest: Manifest;
}): Promise<{ baseInstaller: string | null }> {
  try {
    return await artifactFetcher.ensure(instruction.manifest);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    LogService.getInstance().error('[업데이트] 산출물 확보 실패', undefined, {
      cause,
    });
    reportApply({
      commandId: instruction.commandId,
      deploymentIds: instruction.deploymentIds,
      requested: instruction.manifest.components,
      requestedBase: instruction.manifest.base ?? null,
      outcome: APPLY_OUTCOME.THREW,
      detail: cause,
    });
    throw error;
  }
}

/** 이 매니페스트가 갈아끼우는 서브프로세스들. */
const replacedDevices = (manifest: Manifest) =>
  Object.values(SERIALPORT_PROCESS).filter(
    (process) => process in manifest.components,
  );

/**
 * 지시를 받아 **조용해질 때까지 기다렸다가** 부모에게 적용을 요청한다.
 *
 * 두 단계로 시점을 고른다. **어느 화면인가**는 렌더러가 판단해 이 함수를 부르고(장치가 idle 인지는
 * 화면이 안다), **장치가 지금 바쁜가**는 여기서 본다 — in-flight 는 백엔드만 아는 사실이고, 교체 중에
 * 끊긴 명령은 실패가 아니라 결과 불명이 된다. 도착 경로는 둘이지만 여기서 하나로 합류한다.
 *
 * **받기가 먼저다.** 아직 아무것도 잠그지 않은 상태에서 산출물을 받아 검증하므로 몇 분이 걸려도 게이트를
 * 쥔 채 네트워크를 기다리지 않는다. 받기에 실패하면 잠그기 전에 끝나 아무 흔적도 남지 않는다.
 */
export type ApplyRequest = {
  commandId: string | null;
  /**
   * 도메인 → 서버 배포 행 id. 결과 기록까지 그대로 나른다 — 서버는 결과를 행 단위로 받고 적용은 조합
   * 단위라, 좌표가 여기서 끊기면 재부팅 뒤 어느 행이었는지 모른다. 서버 지시가 아닌 문은 빈 맵이다.
   */
  deploymentIds: Record<string, string>;
  manifest: Manifest;
  /** 되돌림 스택에 대한 방향 — 부모가 push 할지 pop 할지. 기본은 apply(push). */
  kind?: ApplyInstruction['kind'];
};

/**
 * 진입점이 셋(렌더러 드레인·부팅 이어가기·하네스 파일)이라 여기서 줄을 세운다 — 파이프라인은
 * 배타를 가정한다(정숙 대기 → 잠금 → 부모 요청).
 */
const serially = createSerialQueue();

export const applyManifest = (instruction: ApplyRequest): Promise<void> =>
  serially(() => runApply(instruction));

async function runApply(instruction: ApplyRequest): Promise<void> {
  const logger = LogService.getInstance();

  // 지시가 왔다는 것은 설치 잠금이 풀린 지 한참 됐다는 뜻이다 — 부팅 직후에는 우리를
  // 띄운 setup.exe 가 아직 그 파일을 쥐고 있어 여기가 치울 수 있는 첫 안전한 시점이다.
  artifactFetcher.sweepInstalled(platform.appVersion);

  // 이미 그 버전이면 설치하지 않는다. 절약이 아니라 **파괴적이기 때문**이다: 설치본은
  // `resources/target` 을 통째로 갈아치우므로, 지금 돌고 있는 세대 조합이 사라지고
  // 설치본에 구워진 옛 조합으로 되돌아간다. 실수로 한 번 더 보낸 것이 수백 대를 되감는다.
  const { base } = instruction.manifest;
  if (base !== undefined && base === platform.appVersion) {
    logger.info('[업데이트] 이미 같은 설치본입니다 — 설치하지 않습니다', {
      unmasked: { base },
    });
    reportApply({
      commandId: instruction.commandId,
      deploymentIds: instruction.deploymentIds,
      requested: {},
      requestedBase: base,
      // 원한 설치본이 이미 돌고 있다 — 시킨 일은 일어난 것이다.
      outcome: APPLY_OUTCOME.UNCHANGED,
      detail: `이미 ${base} 입니다`,
    });
    return;
  }

  logger.info('[업데이트] 매니페스트 수신 — 산출물을 확보합니다');
  const { baseInstaller } = await ensureArtifacts(instruction);

  logger.info('[업데이트] 산출물 확보 — 장치가 조용해지기를 기다립니다');
  await processManager.awaitQuiescence();

  // 여기서부터 새 요청을 받지 않는다 — 정숙이 표본이 아니라 래치가 된다.
  updateGate.lock();
  logger.info(
    '[업데이트] 조용해짐 — 새 요청을 잠그고 부모에게 적용을 요청합니다',
  );

  // 교체될 장치의 증거를 **요청 전에** 무효화한다. 잠근 뒤라 아무도 답할 수 없어
  // 창이 없다 — 요청 후에 하면 그 사이 응답이 옛 세대의 증거로 승격을 통과시킨다.
  promotionJudge.awaitEvidence(replacedDevices(instruction.manifest));

  // 응답이 온다는 것은 **이 백엔드가 살아남는다**는 뜻이다(교체되면 받을 상대가 없다).
  // 적용이 거절됐거나 프론트·장치만 갈린 경우이므로 게이트를 푼다.
  try {
    await bridge().call(BRIDGE_METHOD.UPDATE_APPLY, {
      ...instruction,
      baseInstaller,
    });
    logger.info('[업데이트] 이 백엔드는 유지됩니다 — 잠금 해제');
  } catch (error) {
    logger.error('[업데이트] 적용 요청 실패 — 잠금 해제', error);
  }
  updateGate.unlock();
}
