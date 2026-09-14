import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { platform } from '@platform/Platform';
import {
  componentSegments,
  isSelfHosted,
  PROCESS_ARCH_OF,
  type SerialportProcess,
} from 'kiosk-types';
import { DEV_READY_TIMEOUT_MS } from 'src/constant/timeouts';
import { runtimeAssets } from 'src/service/RuntimeAssetService';
import { createProcessManager } from '../createProcessManager';
import { mirrorProcessLog, processLogRecord } from '../logMirror';
import { runtimeExecPath } from '../runtime';
import type { ProcessHandle, Spawner } from '../types';

/**
 * electron 없는 환경의 Spawner — 개발(vite-node)과 향후 pm2/Linux 배포 공용.
 *
 * 메시지는 express-ipc 파이프로 오가므로 부모-자식 IPC 채널을 쓰지 않는다(`channel: null`).
 * 여기가 관리하는 것은 **수명뿐**이고, 통신은 transport 가 파이프로 따로 붙는다.
 */
const IS_WIN = globalThis.process.platform === 'win32';
const IS_DEV = globalThis.process.env.NODE_ENV === 'development';

/** 개발에선 서브프로세스 소스 패키지를 그대로 띄운다 — 각자의 HMR 이 유지된다. */
const devPackageDir = (target: SerialportProcess) =>
  path.resolve(
    globalThis.process.cwd(),
    '..',
    'kiosk-serialport',
    'packages',
    target,
  );

function launch(target: SerialportProcess): ChildProcess {
  if (IS_DEV) {
    // 자기 런타임을 들고 오는 자식은 vite-node 로 못 띄운다 — vite-node 가 호스트
    // 아키텍처라 그 자식의 네이티브 의존을 못 연다. 그래서 **빌드된 산출물을 그 런타임으로**
    // 직접 띄운다. HMR 은 없고, 소스를 고치면 그 패키지에서 build 를 한 번 돌린 뒤
    // dev 핫키 [b] 로 되살리면 된다(kill 경로는 아래에서 공용이라 그대로 동작한다).
    if (isSelfHosted(target)) {
      const execPath = runtimeExecPath(PROCESS_ARCH_OF[target]);
      const entry = path.join(devPackageDir(target), 'dist', 'index.js');
      if (!execPath)
        throw new Error(`${target} 런타임 경로를 해소하지 못했습니다`);
      return spawn(execPath, [entry], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...globalThis.process.env, FORCE_COLOR: '1' },
      });
    }
    return spawn('npm', ['run', 'start'], {
      cwd: devPackageDir(target),
      shell: IS_WIN, // Windows 의 npm 은 npm.cmd — 셸을 통해 해소된다
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...globalThis.process.env, FORCE_COLOR: '1' },
    });
  }

  const entry = path.join(
    platform.paths.baseline,
    ...componentSegments(target),
    'index.js',
  );
  return spawn(globalThis.process.execPath, [entry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: globalThis.process.env,
  });
}

const nodeSpawner: Spawner<null> = {
  spawn(target) {
    // 자기 런타임·벤더 자산이 아직 없으면 받기를 킥하고 **이번 요청은 거절한다.**
    //
    // 프로덕션(bridge)은 여기서 기다린다 — 그쪽은 fork 자체가 왕복이라 `ready` 안에
    // 대기를 넣을 수 있다. 이쪽은 `launch()` 가 동기이고 그 자리에서 얻은 ChildProcess 에
    // stdout·exit 리스너가 곧바로 걸리므로, 기다리려면 리스너를 큐에 담는 층을 하나 더
    // 만들어야 한다(bridge impl 이 하는 일). 개발 머신에는 런타임이 이미 깔려 있는 게
    // 정상이고 다음 요청이 곧 성립하므로, 그 복잡도를 dev 에 들이지 않는다.
    if (!runtimeAssets.isReady(target)) {
      void runtimeAssets.whenReady(target);
      throw new Error(
        `${target} 자산을 아직 받지 못했습니다 — 내려받는 중이니 잠시 후 다시 요청하세요`,
      );
    }
    const child = launch(target);
    mirrorProcessLog(
      processLogRecord(target, 'info', `spawn pid=${child.pid ?? 'unknown'}`),
    );

    const lines =
      (listener: (text: string) => void) =>
      (data: Buffer): void => {
        const text = data.toString().trimEnd();
        if (text) listener(text);
      };

    // 자식이 express-ipc 서버를 연 시점 = stdout 의 `[ready]`. 이걸 안 기다리면 첫 요청이
    // 파이프 생성과 경주해서 산발적으로 실패한다.
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const readyTimer = setTimeout(markReady, DEV_READY_TIMEOUT_MS);
    readyTimer.unref?.();
    child.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('[ready]')) {
        clearTimeout(readyTimer);
        markReady();
      }
    });
    child.on('exit', () => {
      clearTimeout(readyTimer);
      markReady();
    });

    const handle: ProcessHandle<null> = {
      channel: null,
      ready,
      onExit: (listener) => {
        child.on('exit', (code) => listener(code));
      },
      onStdout: (listener) => {
        child.stdout?.on('data', lines(listener));
      },
      onStderr: (listener) => {
        child.stderr?.on('data', lines(listener));
      },
      kill: () => {
        if (!child.pid || child.exitCode !== null) return;
        if (IS_WIN) {
          // npm.cmd → vite-node 로 이어지는 자식 트리를 통째로 정리한다. 부모만 죽이면
          // 실제 서브프로세스가 살아남아 COM 포트를 계속 잡는다.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGTERM');
        }
      },
    };
    return handle;
  },
};

export const processManager = createProcessManager({
  spawner: nodeSpawner,
  onLog: mirrorProcessLog,
});

// startEager 는 App.start() 가 부른다 — bridge 타깃과 같은 자리여야 한다(그쪽은
// 모듈 최상위 spawn 이 setBridgeClient 전에 돌아 부팅이 죽는다).

// 백엔드가 내려갈 때 자식을 남기지 않는다 — 남으면 다음 기동이 COM 포트 점유로 실패한다.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  globalThis.process.once(signal, () => {
    processManager.stopAll();
    globalThis.process.exit(0);
  });
}
globalThis.process.once('exit', () => processManager.stopAll());
