import { bridge } from '@bridge/Bridge';
import { platform } from '@platform/Platform';
import {
  type ApplyResultReport,
  BRIDGE_METHOD,
  buildApplyResultReport,
  buildSoftwareStateReport,
  type Manifest,
  type SoftwareStateReport,
} from 'kiosk-types';
import { LogService } from 'src/service/LogService';
import { applyManifest } from 'src/update/applyManifest';
import {
  readBaselineVersions,
  readPointer,
  readStable,
} from 'src/update/generationPath';
import { promotionJudge } from 'src/update/judgeInstance';
import { rollback } from 'src/update/rollback';
import { readApplyRecord, readRollbackStack } from 'src/update/rollbackFiles';

/** 렌더러가 알려오는 것들 — 부팅 완주, 늦게 드러난 계약 불일치, 그리고 적용 지시. */
export class UpdateService {
  async bootCompleted(input: {
    contractTotal: string;
    surface?: string;
  }): Promise<void> {
    // 판정에 쓰는 것은 표면이다 — total 은 로그·진단용으로만 온다. 표면을 안 싣는 옛
    // 프론트는 판정 보류가 되고(백스톱 위임), 완주 사실 자체는 승격 근거로 유효하다.
    promotionJudge.rendererBooted(input.surface);
  }

  /**
   * 렌더러 생존 선언의 전달 — 렌더러 준비 워치독의 해제 신호. 부팅 완주와 분리된 이유: 완주는
   * 터치·네트워크가 껴 있어 무인 부팅에선 영영 오지 않을 수 있고, 워치독이 그걸 근거로 삼으면 멀쩡한
   * 프론트를 되감는다(실측). 흰 화면은 프로세스 이벤트를 안 내 이 선언의 부재만이 증거다.
   */
  async rendererAlive(): Promise<void> {
    void bridge().call(BRIDGE_METHOD.RENDERER_ALIVE);
  }

  /**
   * 런타임 백스톱 — 렌더러가 계약 불일치 응답을 받았다. 지문 대조가 놓친 경우(지문을 안 싣는 옛
   * 산출물 등)를 받는다. 실제로 실패한 호출이라 지문보다 정확하지만 늦게 드러난다.
   */
  async contractMismatch(input: { cause: string }): Promise<void> {
    LogService.getInstance().error(
      '[업데이트] 렌더러가 계약 불일치를 보고 — 되감기 요청',
      undefined,
      { cause: input.cause },
    );
    void bridge().call(BRIDGE_METHOD.UPDATE_ROLLBACK);
  }

  /**
   * 서버 지시를 적용한다 — 렌더러가 **안전한 화면에서** 넘긴 것이다. 응답은 적용을 시작했다는 뜻이지
   * 성공했다는 뜻이 아니다: 이 백엔드가 교체되면 응답 자체가 가지 않고, 결과는 부모가 파일로 남긴다.
   */
  async apply(input: {
    commandId: string;
    deploymentIds: Record<string, string>;
    manifest: Manifest;
  }): Promise<void> {
    await applyManifest(input);
  }

  /** 직전 조합으로 — 목적지는 되돌림 스택이 안다. 응답 계약은 적용과 같다. */
  async rollback(input: { commandId: string }): Promise<void> {
    await rollback(input);
  }

  /**
   * 지금 무엇이 도는가 + 미보고 결과 — 렌더러가 서버로 나른다. 조립은 types 의 순수 함수이고 여기서는
   * 파일을 읽어 넘길 뿐이다(파일은 부모가 쓰고 백엔드는 읽기만 한다).
   */
  async softwareState(): Promise<{
    state: SoftwareStateReport;
    result: ApplyResultReport | null;
  }> {
    const root = platform.paths.baseline;
    const live = readPointer(root);
    const now = new Date().toISOString();
    const lastApply = readApplyRecord();
    // 갱신된 적 없는 컴포넌트도 디스크에서 돌고 있다 — 그 실제 버전을 함께 싣는다.
    const baselineVersions = readBaselineVersions(root);

    // 하나도 못 읽었으면 알린다. 못 읽는 것 자체는 보고를 막지 않지만(그 컴포넌트만
    // 빠진다), 조용히 비면 "콘솔이 왜 전부 비지?"에 로그로 답할 수 없다(실측).
    if (Object.keys(baselineVersions).length === 0) {
      LogService.getInstance().info(
        '[업데이트] 동봉본 버전을 하나도 읽지 못했습니다 — 취합이 version.json 을 남기지 않은 빌드입니다',
        { unmasked: { root } },
      );
    }

    return {
      state: buildSoftwareStateReport({
        appVersion: platform.appVersion,
        live,
        baselineVersions,
        stable: readStable(root),
        stack: readRollbackStack(),
        lastApply,
        now,
      }),
      result: buildApplyResultReport({
        record: lastApply,
        live,
        appVersion: platform.appVersion,
        now,
      }),
    };
  }

  /** 결과가 서버에 갔다 — 부모가 기록에 세운다. 부모가 없으면 세울 기록도 없다(성공). */
  async reported(input: { at: string }): Promise<void> {
    await bridge().call(BRIDGE_METHOD.UPDATE_REPORTED, input);
  }
}
