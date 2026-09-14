import type { Manifest, Pointer } from 'kiosk-types/src/update/generation';
import {
  diffPointers,
  INITIAL_POINTER,
  pointerFromManifest,
} from 'kiosk-types/src/update/generation';
import { planRestart, type RestartPlan } from './applyPlan';
import type { GenerationStore } from './generationStore';

/**
 * 적용 결과. `backendSurvives` 는 요청한 백엔드가 이 적용에서 살아남는지다 — 교체되면 그대로
 * 죽으니 상관없지만 **살아남는 경우엔 누군가 잠금을 풀어줘야** 하고, 부모는 이때만 응답한다.
 */
export type ApplyOutcome = { backendSurvives: boolean } & (
  | { ok: true; applied: string[] }
  | { ok: false; reason: 'missing-generation'; missing: string[] }
  | { ok: false; reason: 'not-ready'; rolledBackTo: 'stable' | 'baseline' }
);

/**
 * 매니페스트를 적용한다 — 교체·검증·되감기. 백엔드가 아니라 여기 사는 이유: 교체당하는
 * 프로세스가 자기 교체를 검증하고 되감을 수는 없다. electron 을 import 하지 않고 효과를
 * 주입받으므로 supervisor 로 옮길 때 어댑터만 갈아끼우면 된다.
 *
 * 실패는 **준비 선언 하나로 판정**한다 — 죽든·멈추든·못 붙든 전부 "선언이 안 왔다"로 수렴한다.
 * 실패 종류마다 탐지기를 두면 빠뜨린 종류가 곧 무한 대기가 된다.
 */
export type ApplyEngine = {
  apply(manifest: Manifest): Promise<ApplyOutcome>;
  /**
   * 사다리를 한 칸 **내려간다**(내려간 곳을 돌려주고, 이미 바닥이면 `null`).
   *
   * 목적지가 아니라 **방향**이다. 목적지("마지막 안정 조합으로")로 부르면 live=baseline 일 때
   * stable 로 **올라가** 두 조합을 오가며 진동하고, live==stable 이면 아무 일도 안 하고 끝나
   * 오염된 stable 에 종착한다(실측).
   */
  descend(reason: string): 'stable' | 'baseline' | null;
};

export function createApplyEngine(deps: {
  store: GenerationStore;
  restart: {
    backend(): void;
    renderer(): void;
    device(component: string): void;
  };
  /** 다음 준비 선언을 기다린다. 상한을 넘기면 reject. */
  awaitReady(): Promise<void>;
  onLog(message: string): void;
}): ApplyEngine {
  const { store, restart, awaitReady, onLog } = deps;

  function execute(plan: RestartPlan): void {
    for (const device of plan.devices) restart.device(device);
    if (plan.renderer) restart.renderer();
    if (plan.backend) restart.backend();
  }

  /** 되감기도 그냥 또 하나의 포인터다 — 적용과 같은 경로를 쓴다. */
  function rollback(to: Pointer, label: string): RestartPlan {
    onLog(`되감기 → ${label}`);
    // 목적지에 없는 컴포넌트도 baseline 으로 되돌아간다 — 목적지는 **완전한 조합**이다.
    const plan = planRestart(diffPointers(store.readPointer(), to));
    store.writePointer(to);
    execute(plan);
    return plan;
  }

  return {
    descend(reason) {
      const live = store.readPointer();
      if (diffPointers(live, INITIAL_POINTER).length === 0) {
        onLog(`이미 동봉본입니다 — 더 내려갈 곳이 없습니다(${reason})`);
        return null;
      }
      onLog(`한 칸 내려갑니다(${reason})`);
      const stable = store.readStable();
      const toStable = diffPointers(live, stable).length > 0;
      const plan = rollback(
        toStable ? stable : INITIAL_POINTER,
        toStable ? '마지막 안정 조합' : 'baseline',
      );
      // 내려간 곳의 백엔드 세대가 그대로면 아무도 다시 띄우지 않는다 — 멈춘 백엔드를 두고 끝나면
      // 워치독 재무장도 없어 인앱 데드엔드가 된다. 이 한 줄이 **판정 상태의 유일한 리셋 경로**
      // 이기도 하다: 백엔드가 갈려야 되감기 래치·witness 관측·불일치 보고 래치가 새로 시작한다.
      if (!plan.backend) restart.backend();
      return toStable ? 'stable' : 'baseline';
    },

    async apply(manifest) {
      const current = store.readPointer();
      const target = pointerFromManifest(manifest, current);
      const changed = diffPointers(current, target);

      if (changed.length === 0) {
        onLog('바뀐 컴포넌트 없음 — 적용 생략');
        return { ok: true, applied: [], backendSurvives: true };
      }

      // 없는 세대를 가리키게 만들지 않는다 — 교체 전에 거른다.
      const missing = changed.filter(
        (c) => !store.hasGeneration(c, manifest.components[c] as string),
      );
      if (missing.length > 0) {
        onLog(`세대 없음 — 적용하지 않음: ${missing.join(', ')}`);
        return {
          ok: false,
          reason: 'missing-generation',
          missing,
          backendSurvives: true,
        };
      }

      const plan = planRestart(changed);
      onLog(`적용: ${changed.join(', ')}`);
      store.writePointer(target);
      execute(plan);

      // 백엔드를 갈지 않았다면 기다릴 준비 선언이 없다 — 렌더러·장치는 스스로 다시 붙는다.
      if (!plan.backend) {
        return { ok: true, applied: changed, backendSurvives: true };
      }

      try {
        await awaitReady();
      } catch {
        const stable = store.readStable();
        rollback(stable, '마지막 안정 조합');
        try {
          await awaitReady();
          return {
            ok: false,
            reason: 'not-ready',
            rolledBackTo: 'stable',
            backendSurvives: false,
          };
        } catch {
          // 마지막 안정 조합마저 못 서면 동봉본으로 — 불가침이라 반드시 실행 가능하다.
          rollback(INITIAL_POINTER, 'baseline');
          return {
            ok: false,
            reason: 'not-ready',
            rolledBackTo: 'baseline',
            backendSurvives: false,
          };
        }
      }

      // 준비 선언은 **되감기 판정**의 근거일 뿐이다. 승격은 하지 않는다 — 계약까지 본
      // 판정자가 유일한 승격 주체다. 여기서 쓰면 판정보다 앞질러 어긋난 조합을 "안전"으로
      // 기록하게 된다(실측: 8ms 차이로 되감을 곳이 오염됐다).
      onLog(`적용 완료: ${changed.join(', ')}`);
      return { ok: true, applied: changed, backendSurvives: false };
    },
  };
}
