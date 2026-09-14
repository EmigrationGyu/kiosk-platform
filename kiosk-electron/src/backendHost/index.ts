import path from 'node:path';
import type { WebContents } from 'electron';
import {
  APPLY_OUTCOME,
  type ApplyOutcomeKind,
  ApplyReportSchema,
} from 'kiosk-types/src/update/applyRecord';
import type {
  ApplyInstruction,
  GenerationMap,
} from 'kiosk-types/src/update/generation';
import { ApplyInstructionSchema } from 'kiosk-types/src/update/generation';
import { z } from 'zod';
import { mainLog } from '../mainLog';
import { createApplyEngine } from '../update/applyEngine';
import type { ApplyRecordStore } from '../update/applyRecordStore';
import type { GenerationStore } from '../update/generationStore';
import type { RollbackLedger } from '../update/rollbackLedger';
import { createBackendProcess } from './backendProcess';
import { createBridgeHost } from './bridgeHost';
import { createCrashEscalator } from './crashEscalator';
import {
  createElectronBackendFork,
  createElectronChannel,
  createElectronFork,
} from './electronAdapters';
import { createPortBroker } from './portBroker';
import { createReadinessWatchdog } from './readinessWatchdog';
import { createSpawnService } from './spawnService';

/** 백엔드가 보내는 "보고됨" 페이로드 — 형식은 여기서 판다(세대가 갈리면 모양도 갈린다). */
const ReportedSchema = z.object({ at: z.string().min(1) });

/**
 * 준비 선언 상한. 실측 부팅은 1초 안쪽이라 10배 여유 — 더 못 늘리는 이유는 supervisor 가
 * heartbeat 30초 끊기면 앱을 통째로 재기동하기 때문이다(되감기 2회 = 20초가 그 안에 들어야 한다).
 */
const BACKEND_READY_TIMEOUT_MS = 10_000;

/** 1회는 재기동으로 풀릴 수 있다(포트 경합 등). 반복되면 산출물 문제라 되감는다. */
const READY_FAILURES_BEFORE_ROLLBACK = 2;

/**
 * 이보다 짧게 살고 죽으면 "빠른 종료" — 부팅 직후 결정적 크래시와 장시간 가동 중의 사고를 가른다.
 * 준비 선언은 기준이 못 된다: 선언 후 크래시하는 세대는 매 사이클 선언·해제해 아무도 반복을 못 센다.
 */
const BACKEND_FAST_DEATH_MS = 30_000;
/** 빠른 종료 연속 몇 회를 세대 문제로 볼 것인가. 즉사 루프는 수 초 안에 도달한다. */
const BACKEND_CRASHES_BEFORE_ROLLBACK = 3;

/**
 * 렌더러가 로드 후 생존(첫 렌더 완료)을 선언하기까지의 상한. 흰 화면(JS 크래시)은 프로세스
 * 이벤트를 하나도 내지 않아 선언의 부재만이 유일한 증거다.
 *
 * 신호가 **부팅 완주가 아니라 생존**인 이유: 완주는 터치·네트워크가 껴 있어 무인 부팅에선
 * 영영 오지 않을 수 있다(실측: 멀쩡한 프론트가 리로드 루프에 갇혔다). 생존은 번들 평가 +
 * 첫 커밋뿐이라 실측 2~3초에 10배 여유다.
 */
const RENDERER_ALIVE_TIMEOUT_MS = 30_000;
/** 1회는 리로드로 풀릴 수 있다(일시 문제). 연속되면 산출물 문제라 되감아야 한다. */
const RENDERER_ALIVE_FAILURES_BEFORE_ROLLBACK = 2;

/**
 * 백엔드 호스트 합성 루트. 메인이 하는 일은 셋뿐이다 — 백엔드를 띄우고, electron 능력을
 * 빌려주고, 포트를 배선한다. 정책은 전부 백엔드에 있다.
 */
export function startBackendHost(deps: {
  getWebContents: () => WebContents | null;
  /** 렌더러를 **지금 포인터가 가리키는 세대로** 다시 띄운다. */
  reloadRenderer: () => void;
  /** 세대 저장소 — 적용 엔진이 포인터를 갈아끼운다. */
  store: GenerationStore;
  /** 적용 결과 기록 — 교체당한 쪽은 자기 결과를 보고할 수 없다. */
  records: ApplyRecordStore;
  /** 되돌림 스택 — 지시가 밀어낸 조합. 운영자 롤백의 목적지. */
  rollbacks: RollbackLedger;
  /** `resources/target`. */
  artifactRoot: string;
  /** 지금 띄워야 하는 백엔드의 위치 — 매 fork 마다 다시 묻는다. */
  resolveBackendEntry: () => string;
  /** 앱 설치본을 띄우고 물러난다. **띄우지 못했을 때만** 결정된다 — 넘겨준 뒤에는 관측할 주체가 없다. */
  installBase: (installerPath: string) => Promise<Error>;
}): {
  rewireRenderer: () => void;
  restartBackend: () => void;
  shutdown: () => void;
} {
  // 자식(백엔드·serialport)은 모두 같은 부트스트랩을 거친다 — 번들이 external 로 남긴
  // 네이티브 모듈을 resources/serialport-modules 에서 해소하기 위해서다.
  const bootstrapPath = path.join(
    process.resourcesPath,
    'target',
    'utility-bootstrap.js',
  );

  // 준비 선언 워치독이 못 보는 크래시 루프(선언 후 크래시·콜드 부팅 즉사)를 센다.
  const crashes = createCrashEscalator({
    fastDeathMs: BACKEND_FAST_DEATH_MS,
    threshold: BACKEND_CRASHES_BEFORE_ROLLBACK,
  });

  const backend = createBackendProcess({
    fork: createElectronBackendFork({
      bootstrapPath,
      artifactRoot: deps.artifactRoot,
      resolveEntry: deps.resolveBackendEntry,
    }),
    autoRestart: true,
    onStdout: (text) => console.log(`[backend] ${text}`),
    onStderr: (text) => {
      console.error(`[backend:stderr] ${text}`);
      mainLog('error', `백엔드 stderr: ${text}`);
    },
    onUnexpectedExit: (code) => {
      mainLog('error', `백엔드가 예기치 않게 종료했습니다 code=${code}`);
      // 적용 창의 크래시 루프는 사다리(awaitReady)가 소유한다 — 여기까지 겹치면 이중 복구다.
      if (crashes.exited(Date.now()) !== 'escalate' || applying) return;
      // 이 콜백 직후 autoRestart 가 같은 세대를 다시 띄운다. 한 틱 뒤에 내려가면 descend
      // 의 재기동이 그 프로세스를 교체하고, 그 kill 의 exit 는 세대 동일성 판정이 걸러
      // 카운터를 오염시키지 않는다 — 동기로 내려가면 이중 spawn 이 된다.
      setImmediate(() => {
        recordSelfDescent(
          APPLY_OUTCOME.ROLLED_BACK,
          `빠른 종료 연속 ${BACKEND_CRASHES_BEFORE_ROLLBACK}회`,
        );
      });
    },
  });

  const spawner = createSpawnService({
    fork: createElectronFork({
      bootstrapPath,
      resourcesPath: process.resourcesPath,
    }),
    createChannel: createElectronChannel,
    notify: (event) => backend.send({ kind: 'event', ...event }),
  });

  const broker = createPortBroker({
    backend,
    getWebContents: deps.getWebContents,
  });

  /**
   * 적용이 진행 중인가 — 그 창에서는 **사다리가 복구를 소유한다.** 워치독과 적용 엔진이 같은
   * 타임아웃을 보고 둘 다 반응하면 백엔드가 두 번 뜨고 렌더러 포트도 두 번 갈린다(실측).
   */
  let applying = false;

  /**
   * 다음 준비 선언을 기다린다 — 새 세대가 실제로 섰는지의 유일한 판정. 죽은 경우는 autoRestart
   * 가 잡지만 멈춘 백엔드는 아무도 잡지 않는다. 상한 초과가 곧 되감기 신호다.
   */
  let readyWaiters: (() => void)[] = [];
  const awaitReady = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('준비 선언 시간 초과')),
        BACKEND_READY_TIMEOUT_MS,
      );
      readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });

  /** 결과를 남긴다(렌더러가 나중에 읽어 서버로 보낸다). 기록 실패가 되감기를 막으면 안 된다. */
  function record(entry: {
    commandId: string | null;
    /** 도메인 → 서버 배포 행 id. 없으면 서버 지시가 아니었다는 뜻이다. */
    deploymentIds?: Record<string, string>;
    requested: GenerationMap;
    requestedBase?: string | null;
    outcome: ApplyOutcomeKind;
    detail: string;
    rolledBackTo?: 'stable' | 'baseline' | null;
  }): void {
    try {
      deps.records.write({
        recordVersion: 1,
        commandId: entry.commandId,
        deploymentIds: entry.deploymentIds ?? {},
        at: new Date().toISOString(),
        requested: entry.requested,
        requestedBase: entry.requestedBase ?? null,
        outcome: entry.outcome,
        detail: entry.detail,
        rolledBackTo: entry.rolledBackTo ?? null,
        reported: false,
      });
    } catch (error) {
      mainLog(
        'error',
        `[업데이트] 결과를 남기지 못했습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 지시 없이 스스로 내려간 경우 — 지금 돌던 조합이 곧 문제의 조합이다. */
  function recordSelfDescent(
    outcome: ApplyOutcomeKind,
    detail: string,
  ): boolean {
    const failing = deps.store.readPointer().components;
    const to = applyEngine.descend(detail);
    if (to === null) return false;
    record({
      commandId: null,
      requested: failing,
      outcome,
      detail,
      rolledBackTo: to,
    });
    return true;
  }

  /**
   * 앱 설치본에 넘긴다 — 성공을 관측할 주체가 남지 않으므로 **넘기기 전에** 기록한다.
   * 돌려주는 값은 "이 백엔드가 살아남는가"다(응답 없음 = 너는 교체된다, 적용과 같은 계약).
   */
  function installBase(
    instruction: Pick<ApplyInstruction, 'kind' | 'commandId' | 'deploymentIds'>,
    version: string,
    installerPath: string | null,
    requested: GenerationMap,
  ): Promise<boolean> {
    const { commandId, deploymentIds } = instruction;
    if (installerPath === null) {
      mainLog('error', '[업데이트] 설치본 경로가 없습니다 — 설치하지 않습니다');
      record({
        commandId,
        deploymentIds,
        requested,
        requestedBase: version,
        outcome: APPLY_OUTCOME.DECLINED,
        detail: '설치본 경로 없음',
      });
      return Promise.resolve(true);
    }

    record({
      commandId,
      deploymentIds,
      requested,
      requestedBase: version,
      outcome: APPLY_OUTCOME.INSTALLING,
      detail: installerPath,
    });
    mainLog('info', `[업데이트] 앱 설치본에 넘깁니다: ${version}`);
    // 넘긴 뒤에는 남지 않는다 — 밀려나는 조합을 지금 적는다. 띄우지 못하면 스택이 한 칸
    // 어긋나지만 방향이 "덜 되돌린다"라 안전하고, 드물다(설치본 파일이 없는 경우뿐).
    deps.rollbacks.handedOff(instruction, deps.store.readPointer());

    return deps.installBase(installerPath).then((failure) => {
      // 띄우지 못했다 — 앱은 그대로 산다. 잠금을 쥔 백엔드를 풀어줘야 한다.
      mainLog(
        'error',
        `[업데이트] 설치본을 띄우지 못했습니다: ${failure.message}`,
      );
      record({
        commandId,
        deploymentIds,
        requested,
        requestedBase: version,
        outcome: APPLY_OUTCOME.THREW,
        detail: failure.message,
      });
      return true;
    });
  }

  const applyEngine = createApplyEngine({
    store: deps.store,
    restart: {
      backend: () => backend.restart(),
      renderer: deps.reloadRenderer,
      // 죽이기만 하면 된다 — 백엔드의 멱등한 ensure 가 새 포인터로 다시 해석해 띄운다.
      device: (component) => spawner.kill(component),
    },
    awaitReady,
    // 파일로 남긴다 — 패키징된 앱에서 메인 콘솔은 아무 데도 보이지 않는다. 업데이트는
    // 정작 기록이 필요한 순간에 렌더러 전송이 끊겨 있으므로 더더욱 여기여야 한다.
    onLog: (message) => mainLog('info', `[업데이트] ${message}`),
  });

  const watchdog = createReadinessWatchdog({
    timeoutMs: BACKEND_READY_TIMEOUT_MS,
    onTimeout: (consecutive) => {
      mainLog(
        'error',
        `백엔드가 ${BACKEND_READY_TIMEOUT_MS}ms 안에 준비 선언을 하지 않았습니다 (연속 ${consecutive}회)`,
      );

      // 재기동만 반복하면 **콜드 부팅에는 사다리가 없다.** live 가 깨진 세대를 가리킨 채
      // 부팅하면 적용 프로미스 체인이 없어 아무도 되감지 않고, 수동 개입까지 벽돌이 된다.
      // 되감기가 성공하면 그 안에서 백엔드를 다시 띄우므로 여기서 또 띄우지 않는다.
      if (consecutive >= READY_FAILURES_BEFORE_ROLLBACK) {
        const descended = recordSelfDescent(
          APPLY_OUTCOME.ROLLED_BACK,
          `준비 선언 연속 ${consecutive}회 실패`,
        );
        if (descended) return;
      }
      backend.restart();
    },
  });

  /**
   * 렌더러의 준비 워치독 — 백엔드 워치독과 대칭이되 재무장 지점이 다르다. 모든 렌더러 로드
   * (콜드 부팅·교체·크래시 복구)는 dom-ready → rewireRenderer 를 지나므로 거기서 무장하고,
   * 선언의 전달로 해제한다. 해제만이 횟수를 지운다 — 리로드는 실패의 결과지 성공의 증거가 아니다.
   */
  const rendererWatchdog = createReadinessWatchdog({
    timeoutMs: RENDERER_ALIVE_TIMEOUT_MS,
    onTimeout: (consecutive) => {
      mainLog(
        'error',
        `렌더러가 ${RENDERER_ALIVE_TIMEOUT_MS}ms 안에 생존을 선언하지 않았습니다 (연속 ${consecutive}회)`,
      );
      if (consecutive >= RENDERER_ALIVE_FAILURES_BEFORE_ROLLBACK) {
        const descended = recordSelfDescent(
          APPLY_OUTCOME.ROLLED_BACK,
          `렌더러 생존 선언 연속 ${consecutive}회 없음`,
        );
        // 내려갔으면 그 안의 리로드·재선언이 해제를 만든다. 선언이 여전히 없으면 다음
        // 타임아웃이 한 칸 더 내려간다. 바닥이면(false) 리로드 루프로라도 버틴다.
        if (descended) {
          rendererWatchdog.arm();
          return;
        }
      }
      deps.reloadRenderer();
      rendererWatchdog.arm();
    },
  });

  createBridgeHost({
    backend,
    spawner,
    onRendererPortSubscribe: () => {
      watchdog.disarm();
      broker.backendSubscribed();
      const woken = readyWaiters;
      readyWaiters = [];
      for (const resolve of woken) resolve();
    },
    onRendererAlive: () => rendererWatchdog.disarm(),
    // 목적지가 아니라 방향으로 부른다 — live==stable 인데 말이 안 통하면 stable 도
    // 어긋난 조합이라는 뜻이고, 목적지로 부르면 그 자리에서 no-op 으로 끝난다.
    onRollback: () => {
      recordSelfDescent(APPLY_OUTCOME.MISMATCH, '계약 불일치');
    },
    // 백엔드가 본 결과를 그대로 굳힌다 — 형식은 여기서 판다(세대가 갈리면 모양도 갈린다).
    onReported: (payload) => {
      const parsed = ReportedSchema.safeParse(payload);
      if (!parsed.success) return;
      if (deps.records.markReported(parsed.data.at)) {
        mainLog('info', `[업데이트] 기록 보고됨: ${parsed.data.at}`);
      }
    },
    onUpdateRecord: (payload) => {
      const parsed = ApplyReportSchema.safeParse(payload);
      if (!parsed.success) {
        mainLog('error', '[업데이트] 결과 보고 형식 오류 — 남기지 않습니다');
        return;
      }
      record(parsed.data);
      mainLog(
        'info',
        `[업데이트] 백엔드 보고를 남겼습니다: ${parsed.data.outcome} — ${parsed.data.detail}`,
      );
    },
    onMarkStable: () => {
      deps.store.promoteLiveToStable();
      mainLog('info', '[업데이트] 조합이 도는 것을 확인 — 안정 조합으로 승격');
      // 승격 직후가 참조가 확정되는 시점이다. 참조되지 않은 것도 곧 쓰일 수 있으므로
      // 지우지 않고 **상한을 넘는 만큼만** 잘라낸다.
      const removed = deps.store.pruneGenerations(deps.rollbacks.held);
      if (removed.length > 0) {
        mainLog('info', `[업데이트] 오래된 세대 정리: ${removed.join(', ')}`);
      }
    },
    onUpdateApply: async (manifest) => {
      // 백엔드는 이 요청을 보내기 직전에 새 요청을 잠갔다. 그 사실을 여기서도 남긴다 —
      // 백엔드 쪽 로그는 곧 프로세스가 죽어 flush 되지 못하고 유실될 수 있다(실측).
      mainLog(
        'info',
        '[업데이트] 적용 요청 수신 — 백엔드가 새 요청을 잠갔습니다',
      );
      const parsed = ApplyInstructionSchema.safeParse(manifest);
      if (!parsed.success) {
        mainLog('error', '[업데이트] 적용 지시 형식 오류 — 적용하지 않습니다');
        return true;
      }
      const {
        commandId,
        deploymentIds,
        kind,
        manifest: wanted,
        baseInstaller,
      } = parsed.data;
      const requested = wanted.components;

      // 앱 설치는 세대 교체가 아니라 전부를 갈아치우는 다른 축이다 — 포인터를 건드리지
      // 않고, 사다리도 타지 않는다(되감을 곳이 없다).
      if (wanted.base !== undefined) {
        return installBase(parsed.data, wanted.base, baseInstaller, requested);
      }

      // 밀려나는 조합은 갈리기 전에 읽어야 한다.
      const before = deps.store.readPointer();
      applying = true;
      try {
        const outcome = await applyEngine.apply(wanted);
        if (outcome.ok) {
          deps.rollbacks.applied({ kind, commandId }, before, outcome.applied);
          record({
            commandId,
            deploymentIds,
            requested,
            // 바꿀 것이 없었다는 것은 원한 조합이 이미 돌고 있다는 뜻이다 —
            // 거절이 아니라 달성이다.
            outcome:
              outcome.applied.length > 0
                ? APPLY_OUTCOME.APPLIED
                : APPLY_OUTCOME.UNCHANGED,
            detail:
              outcome.applied.length > 0
                ? outcome.applied.join(', ')
                : '바뀐 컴포넌트 없음',
          });
          return outcome.backendSurvives;
        }

        mainLog('error', `[업데이트] 적용 실패: ${outcome.reason}`);
        if (outcome.reason === 'missing-generation') {
          record({
            commandId,
            deploymentIds,
            requested,
            outcome: APPLY_OUTCOME.DECLINED,
            detail: `세대 없음: ${outcome.missing.join(', ')}`,
          });
        } else {
          record({
            commandId,
            deploymentIds,
            requested,
            outcome: APPLY_OUTCOME.ROLLED_BACK,
            detail: '새 조합이 준비 선언을 하지 않았습니다',
            rolledBackTo: outcome.rolledBackTo,
          });
          // 동봉본까지 내려간 뒤에는 준비 선언을 기다리지 않는다 — 그것마저 멈추면
          // 감시자가 없다. 사다리가 끝났으니 감시를 되돌려받는다.
          if (outcome.rolledBackTo === 'baseline') watchdog.arm();
        }
        return outcome.backendSurvives;
      } catch (error) {
        // 던졌다면 응답해서 **풀어준다**. 응답 없음은 "너는 교체된다"는 뜻이라, 여기서
        // 삼키면 백엔드가 잠금을 쥔 채 매달린다(포인터 쓰기의 EPERM 등 실재 경로).
        // 이미 교체된 뒤였다면 이 응답은 죽은 포트로 가 아무 일도 하지 않는다.
        const cause = error instanceof Error ? error.message : String(error);
        mainLog(
          'error',
          `[업데이트] 적용이 던졌습니다 — 잠금을 풀어줍니다: ${cause}`,
        );
        record({
          commandId,
          deploymentIds,
          requested,
          outcome: APPLY_OUTCOME.THREW,
          detail: cause,
        });
        return true;
      } finally {
        applying = false;
      }
    },
  });

  // 백엔드가 갈릴 때마다(명시적 재기동·크래시 복구 모두) 옛 중계를 끊는다 — 죽은 포트로 자식
  // 응답을 흘리지 않기 위해서다. 옛 포트 구독도 그 프로세스와 함께 사라졌으므로, 새 백엔드가
  // 스스로 다시 걸기 전까지는 배선하지 않는다(첫 요청의 ensure 가 멱등하게 재발급한다).
  backend.onStarted(() => {
    // 기동 시각을 적는다 — 이게 없으면 모든 죽음이 "빠른 종료"로 세어져, 며칠 간격의
    // 정상 가동 후 크래시도 누적돼 내려간다(수명이 유일한 무죄 증거다).
    crashes.started(Date.now());
    spawner.detachAll();
    broker.backendGone();
    // 적용 중이면 무장하지 않는다 — 그 창의 복구는 사다리가 맡는다.
    if (!applying) watchdog.arm();
  });

  backend.start();
  // 콜드 부팅의 첫 로드는 rewireRenderer 이전에 시작된다 — dom-ready 조차 안 오는
  // 재앙(로드 실패)까지 받으려면 여기서 한 번 무장해 둔다. dom-ready 가 오면 갱신된다.
  rendererWatchdog.arm();

  return {
    rewireRenderer: () => {
      // 모든 렌더러 로드가 여길 지난다 — 로드마다 선언 마감시계를 다시 건다.
      rendererWatchdog.arm();
      broker.rendererLoaded();
    },
    // 앱이 내려갈 때 호출한다. 이걸 안 부르면 백엔드 exit 를 "예기치 않은 종료"로 보고
    // autoRestart 가 되살리는데, 그 시점엔 창이 이미 파괴돼 배선이 터진다.
    shutdown: () => backend.kill(),
    restartBackend: () => {
      // 백엔드만 갈아끼운다 — 자식(하드웨어)은 메인의 자식이라 살아있고, 백엔드가 다시 뜨면
      // spawnService.ensure 가 멱등하게 재연결한다. (중계 정리는 onStarted 담당.)
      backend.restart();
    },
  };
}
