import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, MessageChannelMain, utilityProcess } from 'electron';
import { BRIDGE_ENV } from 'kiosk-types/src/bridge/envelope';
import type { BackendChildLike } from './backendProcess';
import type { ChildLike, PortLike } from './spawnService';

/**
 * 백엔드 자식의 electron 구현. Platform 값은 env 로 넘긴다 — 동기 상수라 RPC 왕복을
 * 기다릴 수 없고, 부팅 시 확정되어 변하지 않으므로 한 번 넘기면 충분하다.
 */
export function createElectronBackendFork(options: {
  bootstrapPath: string;
  /** `resources/target` — 백엔드가 장치 세대를 해석하는 기준점. */
  artifactRoot: string;
  /** 지금 띄워야 하는 백엔드의 위치. **매 fork 마다 다시 묻는다** — 세대가 갈렸으면 그게 반영돼야 한다. */
  resolveEntry: () => string;
}): () => BackendChildLike {
  return () => {
    const entry = options.resolveEntry();

    const proc = utilityProcess.fork(options.bootstrapPath, [entry], {
      env: {
        ...(process.env as Record<string, string>),
        [BRIDGE_ENV.USER_DATA]: app.getPath('userData'),
        [BRIDGE_ENV.BASELINE]: options.artifactRoot,
        [BRIDGE_ENV.APP_VERSION]: app.getVersion(),
        [BRIDGE_ENV.IS_PACKAGED]: String(app.isPackaged),
      },
      // utilityProcess 의 기본값은 inherit 이고, 그러면 `proc.stdout` 이 **null** 이라
      // 아래 리스너가 조용히 아무것도 하지 않는다. 자식의 출력을 받아 보려면 pipe 여야 한다.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      postMessage: (message, transfer) =>
        proc.postMessage(
          message,
          transfer as Parameters<typeof proc.postMessage>[1],
        ),
      onMessage: (listener) => {
        proc.on('message', listener);
      },
      onSpawn: (listener) => {
        proc.on('spawn', listener);
      },
      onExit: (listener) => {
        proc.on('exit', (code) => listener(code));
      },
      onStdout: (listener) => {
        proc.stdout?.on('data', (chunk: Buffer) =>
          listener(chunk.toString().trimEnd()),
        );
      },
      onStderr: (listener) => {
        proc.stderr?.on('data', (chunk: Buffer) =>
          listener(chunk.toString().trimEnd()),
        );
      },
      kill: () => {
        proc.kill();
      },
    };
  };
}

/**
 * 자기 런타임을 들고 오는 자식의 fork — **utilityProcess 가 아니라 평범한 Node 자식**이다.
 * 네이티브 의존이 호스트와 다른 아키텍처로만 배포되면(32비트 벤더 DLL) electron 런타임에
 * 얹히지 못한다. `execPath` 로 그 런타임을 지정해 띄우고 Node 표준 IPC 채널로 말한다.
 * **왜 그래야 하는지는 여기서 모른다** — 아키텍처 판정도 경로 해소도 백엔드 몫이다.
 *
 * 부트스트랩을 utilityProcess 와 공유해도 되는 이유: `utility-bootstrap.js` 는 electron 을
 * import 하지 않는다(모듈 검색 경로만 손보고 `process.argv[2]` 를 require). 채널을 아는 것은
 * 자식의 빌드 산출물이고, 그 esbuild alias 선택과 여기 `execPath` 유무는 같은 선언
 * (`PROCESS_ARCH_OF`/`isSelfHosted`)에서 파생하므로 서로 갈릴 수 없다.
 */
function forkNative(
  bootstrapPath: string,
  entry: string,
  execPath: string,
  resourcesPath: string,
): ChildLike {
  // 이 자식은 electron 이 아니다 — 부모가 켜 둔 표식을 물려받으면 안 된다.
  const { ELECTRON_RUN_AS_NODE: _hostFlag, ...parentEnv } =
    process.env as Record<string, string>;

  // `fork` 가 아니라 `spawn` + `'ipc'` 다 — 같은 채널이 깔리고, 호스트(electron)의
  // execArgv 를 물려주지 않으며, `windowsHide` 를 타입이 받는다(ForkOptions 에는 없다).
  const proc = spawn(execPath, [bootstrapPath, entry], {
    env: { ...parentEnv, RESOURCES_PATH: resourcesPath },
    // utilityProcess 와 같은 이유로 파이프다(로그가 이리로 온다) + IPC 채널.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // 콘솔 서브시스템 실행파일이라 GUI 부모에서 띄우면 Windows 가 콘솔 창을 만들 수 있다.
    windowsHide: true,
  });

  /**
   * **`'error'` 를 받지 않으면 메인이 죽는다.** `ChildProcess` 는 EventEmitter 라 리스너 없는
   * `'error'` 가 uncaught exception 이 되고 여기는 메인 프로세스다 — 즉 키오스크 전체가
   * 내려간다(형제인 utilityProcess 에는 이 이벤트가 없어 그쪽엔 없던 위험이다).
   *
   * 두 경로로 온다: ① spawn 실패(execPath 가 없는 실행파일) ② 종료된 자식에 `send()`.
   * 둘 다 여기서 더 할 게 없으므로 종료로 접어 흘린다 — 재시도는 백엔드 몫이고 사유는
   * stderr 채널로 올려 백엔드 로그에 남는다.
   */
  let notifyExit: ((code: number | null) => void) | null = null;
  let notifyStderr: ((text: string) => void) | null = null;
  let ended = false;
  const end = (code: number | null) => {
    if (ended) return;
    ended = true;
    notifyExit?.(code);
  };

  proc.on('exit', (code) => end(code));
  proc.on('error', (error: Error) => {
    notifyStderr?.(`자식 IPC/spawn 오류: ${error.message}`);
    end(null);
  });

  return {
    postMessage: (message) => {
      proc.send(message as object);
    },
    on: (_event, listener) => {
      proc.on('message', listener);
    },
    // 종료 통지는 `end` 가 소유한다 — spawn 실패도 같은 문으로 나가야 하고, 그 경우
    // `'exit'` 는 오지 않는다.
    onExit: (listener) => {
      notifyExit = listener;
    },
    onStdout: (listener) => {
      proc.stdout?.on('data', (chunk: Buffer) =>
        listener(chunk.toString().trimEnd()),
      );
    },
    onStderr: (listener) => {
      notifyStderr = listener;
      proc.stderr?.on('data', (chunk: Buffer) =>
        listener(chunk.toString().trimEnd()),
      );
    },
    kill: () => {
      proc.kill();
    },
  };
}

/** electron import 를 이 파일로 몰아 spawnService 를 순수 로직으로 남긴다(단위 테스트 가능). */
export function createElectronFork(options: {
  bootstrapPath: string;
  resourcesPath: string;
}) {
  return (entry: string, execPath?: string): ChildLike => {
    if (execPath) {
      return forkNative(
        options.bootstrapPath,
        entry,
        execPath,
        options.resourcesPath,
      );
    }
    const proc = utilityProcess.fork(options.bootstrapPath, [entry], {
      env: {
        ...(process.env as Record<string, string>),
        RESOURCES_PATH: options.resourcesPath,
      },
      // **로그가 이 파이프로 온다.** 기본값(inherit)이면 `proc.stdout` 이 null 이라 리스너가
      // 안 걸리고, 패키징된 앱에선 자식 로그가 아무 데도 남지 않는다.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      postMessage: (message) => proc.postMessage(message),
      on: (_event, listener) => {
        proc.on('message', listener);
      },
      onExit: (listener) => {
        proc.on('exit', (code) => listener(code));
      },
      onStdout: (listener) => {
        proc.stdout?.on('data', (chunk: Buffer) =>
          listener(chunk.toString().trimEnd()),
        );
      },
      onStderr: (listener) => {
        proc.stderr?.on('data', (chunk: Buffer) =>
          listener(chunk.toString().trimEnd()),
        );
      },
      kill: () => {
        proc.kill();
      },
    };
  };
}

export const createElectronChannel = (): {
  port1: PortLike;
  port2: PortLike;
} => new MessageChannelMain();

/**
 * 물러난 뒤에 앱 설치본이 뜨게 한다. **우리가 먼저 완전히 내려가야 한다** — Setup.exe 는
 * 버전 방향과 무관하게 설치 디렉토리를 통째로 지우고 새로 까는데, 우리가 떠 있으면 그 삭제가
 * 우리 exe 에서 막힌다(실측: 올릴 때는 우연히 통과했고 되돌릴 때는 Update.exe 까지 지운 채
 * 실패했다). 그래서 우리 PID 가 사라지길 기다렸다 띄우는 런처만 떼어놓고 즉시 종료한다.
 * 먼저 종료해도 daemon 이 `installing` 기록을 읽어 설치 유예를 잡는다(kiosk-install).
 *
 * 다시 띄우는 것은 우리 일이 아니다: Setup.exe 가 끝나면 새 버전을 띄우고, 그마저 없으면
 * daemon 의 `Kiosk` 작업이 버전 불변 stub 을 실행한다.
 */
export function installBaseAndQuit(
  installerPath: string,
  onLog: (message: string) => void,
): Promise<Error> {
  // **띄우지 못했을 때만** 결정된다. 넘겨준 뒤에는 결정되지 않는 것이 계약이다 —
  // 부모의 적용 응답과 같은 규칙이라(응답 없음 = 너는 교체된다) 호출부가 분기하지 않는다.
  return new Promise((resolve) => {
    // `cmd /c start` 로 한 겹 감싼다 — 직접 띄운 powershell 은 detached·stdio·windowsHide
    // 어느 조합이든 부모가 죽을 때 함께 죽었다(node 24 실측). `start` 가 만든 새 콘솔의
    // 프로세스만 살아남는다.
    const launcher = spawn(
      'cmd.exe',
      [
        '/c',
        'start',
        '""',
        '/min',
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        // 작은따옴표 경로 — PowerShell 문자열 안에서 이스케이프가 필요 없는 유일한 형태.
        `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue; Start-Process -FilePath '${installerPath.replace(/'/g, "''")}'`,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    launcher.unref();
    launcher.on('error', resolve);
    launcher.on('spawn', () => {
      onLog('설치 런처를 떼어놓았습니다 — 앱을 내립니다');
      app.quit();
    });
  });
}
