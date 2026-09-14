import { bridge } from '@bridge/Bridge';
import { platform } from '@platform/Platform';
import { BRIDGE_METHOD, PROCESS_ARCH_OF } from 'kiosk-types';
import { runtimeAssets } from 'src/service/RuntimeAssetService';
import { resolveEntry } from 'src/update/generationPath';
import { createProcessManager } from '../createProcessManager';
import { mirrorProcessLog, processLogRecord } from '../logMirror';
import { runtimeExecPath } from '../runtime';
import type { ProcessHandle, Spawner } from '../types';
import { type BufferedChannel, createBufferedChannel } from './bufferedChannel';

/**
 * 자식 프로세스로 도는 백엔드용 Spawner — fork 는 부모(electron 메인)가 대행한다.
 * 실행 경로는 여기서 정한다(세대 해소는 정책이라 백엔드에 남는다).
 *
 * `spawn` 은 동기 계약인데 fork 는 왕복이라, 포트 도착 전 `postMessage` 를 큐에 담았다가
 * flush 한다 — 소비처가 `ready` 를 기다리도록 고치지 않아도 되게.
 */
const bridgeSpawner: Spawner<BufferedChannel> = {
  spawn(target) {
    const entry = resolveEntry(platform.paths.baseline, target);
    // "요청"이지 "생성"이 아니다 — 부모의 ensure 는 멱등이라 살아있으면 포트만 새로 준다.
    mirrorProcessLog(
      processLogRecord(target, 'info', `자식 연결 요청 entry=${entry}`),
    );

    const channel = createBufferedChannel();
    let markReady: () => void = () => undefined;
    let failReady: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
    });
    // 기다리는 요청이 없는 순간의 reject 가 unhandled rejection 으로 프로세스를 죽이지
    // 않게 한다. 요청 쪽(readyGate)은 자기 핸들러로 받으므로 이 catch 와 무관하다.
    ready.catch(() => undefined);

    const exitListeners: ((code: number | null) => void)[] = [];
    const stdoutListeners: ((text: string) => void)[] = [];
    const stderrListeners: ((text: string) => void)[] = [];

    // 이 배선의 수명은 자식 하나다. 안 떼면 재spawn 마다 쌓여, exit 한 번에 옛 세대의
    // 콜백까지 전부 발화한다 — idle reaper 가 회수·재spawn 을 반복하므로 선형으로 는다.
    const detach = bridge().onProcessEvent((event) => {
      if (event.process !== target) return;
      if (event.event === 'exit') {
        detach();
        for (const l of exitListeners) l(event.code ?? null);
      } else if (event.event === 'stdout') {
        for (const l of stdoutListeners) l(event.text ?? '');
      } else {
        for (const l of stderrListeners) l(event.text ?? '');
      }
    });

    // 자기 런타임·벤더 자산이 필요한 자식이면 그것부터 갖춰야 띄울 수 있다. 이미 받고
    // 있으면 그 작업에 합류한다 — 여기서 기다리는 시간은 `ready` 안에 들어가므로, 요청
    // 예산이 아니라 준비 게이트가 그것을 잰다(hardwareTransport/readyGate).
    runtimeAssets
      .whenReady(target)
      .then(() =>
        // execPath 없음 = 호스트 런타임(utilityProcess). 있으면 부모가 그것으로 fork 한다.
        // 부모는 왜인지 모른다 — 판정도 경로 해소도 이쪽 몫이다.
        bridge().call(BRIDGE_METHOD.PROCESS_SPAWN, {
          process: target,
          entry,
          execPath: runtimeExecPath(PROCESS_ARCH_OF[target]) ?? undefined,
        }),
      )
      .then(({ port }) => {
        if (!port) {
          throw new Error(`부모가 ${target} 포트를 넘겨주지 않았습니다`);
        }
        channel.attach(port);
        markReady();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        mirrorProcessLog(
          processLogRecord(target, 'error', `fork 실패: ${message}`),
        );
        // 자식이 없는 핸들을 살아있는 것으로 두면 안 된다 — `live` 에 남은 채 exit 도
        // 오지 않아, 이후 요청이 전부 죽은 채널에서 타임아웃하고 아무도 다시 띄우지
        // 않는다(자산 다운로드 실패 한 번이 백엔드 재시작 전까지 굳는다). 종료로 접어
        // 매니저가 거두게 하고, 기다리는 요청에는 타임아웃 대신 사유를 바로 준다.
        detach();
        for (const l of exitListeners) l(null);
        failReady(error instanceof Error ? error : new Error(message));
      });

    const handle: ProcessHandle<BufferedChannel> = {
      channel,
      ready,
      onExit: (listener) => {
        exitListeners.push(listener);
      },
      onStdout: (listener) => {
        stdoutListeners.push(listener);
      },
      onStderr: (listener) => {
        stderrListeners.push(listener);
      },
      kill: () => {
        void bridge().call(BRIDGE_METHOD.PROCESS_KILL, { process: target });
      },
    };
    return handle;
  },
};

export const processManager = createProcessManager({
  spawner: bridgeSpawner,
  onLog: mirrorProcessLog,
});

// startEager 는 여기서 부르면 안 된다 — App.start() 의 몫이다. ESM 은 import 를 엔트리
// 본문보다 먼저 평가하므로, 모듈 최상위 spawn 은 index.bridge.ts 의 setBridgeClient 보다
// 먼저 돌아 bridge() 미설정으로 부팅이 죽는다(패키징에서 실측 — EAGER 가 비어 있던
// 동안만 잠복했다).
