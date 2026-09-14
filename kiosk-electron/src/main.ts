import { homedir } from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, globalShortcut, powerSaveBlocker } from 'electron';
import started from 'electron-squirrel-startup';
import {
  ARTIFACT_ROOT_DIR,
  LOCAL_DATA_DIR,
  LOCAL_UPDATE_DIR,
  UPDATE_COMPONENT,
} from 'kiosk-types/src/update/components';
import { UPDATABLE_COMPONENTS } from 'kiosk-types/src/update/generation';
import { startBackendHost } from './backendHost';
import { installBaseAndQuit } from './backendHost/electronAdapters';
import { mainLog } from './mainLog';
import { createApplyRecordStore } from './update/applyRecordStore';
import { createGenerationStore } from './update/generationStore';
import { reconcileInstall } from './update/reconcileInstall';
import { createRollbackLedger } from './update/rollbackLedger';
import { createRollbackStackStore } from './update/rollbackStackStore';

// Squirrel 설치/제거 이벤트: electron-squirrel-startup 이 숏컷 생성/제거를 처리한 뒤 종료.
// (키오스크 자동시작 작업 Kiosk 은 supervisor daemon 이 소유·생성하므로 여기선 손대지 않는다.)
if (started) {
  app.quit();
}

/**
 * Squirrel 이벤트 실행(`--squirrel-install` 등)은 숏컷만 만들고 나가야 한다. `quit()` 은
 * Update.exe 가 끝난 뒤에야 먹으므로 그 사이 `ready` 가 발화해 백엔드까지 통째로 뜬다
 * (실측: 설치 직후 백엔드 둘, heartbeat 파이프 EADDRINUSE).
 */
const onReady = (handler: () => void): void => {
  if (!started) app.on('ready', handler);
};

/**
 * 메인의 잡히지 않은 예외는 모달 없이 죽인다 — 에러 모달은 프로세스를 살려둬 자동 복구를
 * 막는다(heartbeat 는 백엔드가 보내므로 메인만 멈추면 워치독이 정상으로 오인한다).
 * 죽기 전 파일로 남긴다: 패키징된 앱에서 메인 콘솔은 보이지 않는다.
 */
process.on('uncaughtException', (error) => {
  mainLog('error', `uncaught: ${error?.stack ?? String(error)}`);
  app.exit(1);
});

const IS_DEV = process.env.NODE_ENV === 'development';
const RENDERER_DEV_SERVER_URL = 'http://localhost:5173';
/**
 * 교체 가능한 사본들의 저장소. 렌더러는 asar 밖에서 로드한다 — asar 안이면 무결성 검증
 * 대상이라 원격 업데이트로 교체할 수 없다.
 */
const ARTIFACT_ROOT = path.join(process.resourcesPath, ARTIFACT_ROOT_DIR);

const generations = createGenerationStore({
  artifactRoot: ARTIFACT_ROOT,
  onLog: (message) => mainLog('info', `[세대] ${message}`),
});

// resources/target 이 아니다 — 앱 설치가 그 디렉토리를 통째로 갈아치우므로, 거기 둔
// 기록은 결과를 남겨야 할 바로 그 순간에 사라진다.
const UPDATE_DIR = path.join(homedir(), LOCAL_DATA_DIR, LOCAL_UPDATE_DIR);

const applyRecords = createApplyRecordStore({
  dir: UPDATE_DIR,
  onLog: (message) => mainLog('error', `[업데이트] ${message}`),
});

// 되돌림 스택도 같은 자리 — 설치본이 갈려도 "그 전에 무엇이 돌았나"는 남아야 한다.
const rollbacks = createRollbackLedger({
  stack: createRollbackStackStore({
    dir: UPDATE_DIR,
    onLog: (message) => mainLog('error', `[업데이트] ${message}`),
  }),
  appVersion: app.getVersion(),
});

// 설치를 넘긴 기록은 넘긴 쪽이 닫을 수 없다 — 다시 뜬 우리가 자기 버전으로 닫는다.
// **닫기만 하고 설치본은 치우지 않는다**: 우리를 띄운 setup.exe 가 아직 살아 있어 그
// 디렉토리를 지우면 EPERM 이 나고, top-level 이라 그대로 메인이 죽는다(실측: 1.25.0·1.26.0
// 설치 직후 첫 부팅이 매번 크래시 후 재기동). 수거는 백엔드 `sweepInstalled` 단독 담당.
const settled = reconcileInstall(applyRecords.read(), app.getVersion());
if (settled) {
  applyRecords.write(settled);
  mainLog('info', `[업데이트] 설치가 반영됐습니다: ${app.getVersion()}`);
}

/** 지금 로드해야 하는 렌더러. 매번 해석한다 — 리로드 시점의 포인터를 따라야 한다. */
const rendererIndex = (): string =>
  path.join(generations.resolveDir(UPDATE_COMPONENT.FRONTEND), 'index.html');

const ZOOM_FACTOR = 2.4;
const setZoomFactor = (window: BrowserWindow) => {
  window.webContents.setZoomFactor(ZOOM_FACTOR);
};

/** portBroker 가 렌더러를 찾을 수 있도록 창 참조를 모듈 스코프에 둔다. */
let mainWindow: BrowserWindow | null = null;
/**
 * 렌더러가 한 번이라도 로드를 마쳤는지 — **켜지기만 하는 래치**다. did-start-loading 으로
 * 내렸더니 짝이 되는 완료 이벤트가 안 오는 발화(서브프레임 등)에서 false 로 걸린 채
 * 복구되지 않아 재기동 뒤 모든 요청이 타임아웃했다(실측).
 */
let rendererLoadedOnce = false;
let backendHost: ReturnType<typeof startBackendHost> | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    // frame 은 런타임에 못 바꾸므로 framed 로 만들고, 평상시엔 kiosk+fullscreen 이 가린다.
    // 정비 모드에서 kiosk/fullscreen 을 끄면 프레임이 자연히 드러난다.
    frame: true,
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      zoomFactor: ZOOM_FACTOR,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  const window = mainWindow;

  // Block content navigation and new windows — a kiosk must stay on its own app.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // `will-navigate` 는 **렌더러가 시작한** 내비게이션에만 발화한다 — F5·webContents.reload()
  // 는 안 걸리고 `window.location.reload()` 만 걸리므로, 무조건 preventDefault 하면 앱이 스스로
  // 리로드하는 길만 정확히(예외도 로그도 없이) 막힌다. 목적은 외부 콘텐츠 이탈 차단이지 자가
  // 복구 차단이 아니므로, 자기 문서로의 내비게이션은 통과시킨다.
  const documentOf = (url: string) => url.split('#')[0];
  window.webContents.on('will-navigate', (event, url) => {
    if (documentOf(url) === documentOf(window.webContents.getURL())) return;
    event.preventDefault();
  });

  /**
   * 백엔드 포트 배선 — `load` 가 아니라 `dom-ready` 에서 한다. 필요한 사실("트랜스포트가
   * 리스너를 걸었나")은 모듈 평가 시점에 참인데 `load` 는 폰트·로티까지 기다려 **4.3초**
   * 늦었고, 그 사이 쌓인 부팅 요청 중 타임아웃이 짧은 것(토큰 복구 1.5초)이 죽었다(실측).
   * 렌더러가 갈릴 때마다 다시 깐다 — MessagePort 는 재연결이 없다.
   */
  window.webContents.on('dom-ready', () => {
    rendererLoadedOnce = true;
    mainLog('info', '렌더러 DOM 준비 — 배선 시도');
    backendHost?.rewireRenderer();
  });

  // Lock visual (pinch) zoom — content scale is fixed via zoomFactor.
  window.webContents.on('did-finish-load', () => {
    window.webContents.setVisualZoomLevelLimits(1, 1);
  });

  // Unattended recovery: reload if the renderer crashes or hangs.
  window.webContents.on('render-process-gone', () => {
    window.webContents.reload();
  });
  window.webContents.on('unresponsive', () => {
    window.webContents.reload();
  });

  window.webContents.on('devtools-opened', () => {
    setZoomFactor(window);
  });

  window.webContents.on('devtools-closed', () => {
    setZoomFactor(window);
  });

  // 창이 사라지면 참조를 놓는다 — 파괴된 창을 배선하려다 메인이 죽는 것을 막는 1차 방어.
  window.on('closed', () => {
    mainWindow = null;
    rendererLoadedOnce = false;
  });

  // Maintain zoomFactor when window loses/regains focus (e.g., after pressing Windows key)
  window.on('blur', () => {
    setZoomFactor(window);
  });

  window.on('focus', () => {
    setZoomFactor(window);
  });

  // 백엔드만 재기동한다 — 자식(하드웨어)은 메인의 자식이라 살아남고 멱등한 ensure 가 재연결한다.
  // 원격 부분 업데이트의 적용 경로와 같아, 스모크에서 그 경로를 손으로 밟아보는 수단이기도 하다.
  globalShortcut.register('Control+Shift+B', () => {
    if (!backendHost) {
      console.warn('[main] backendHost 미기동 — 재기동할 대상이 없습니다.');
      return;
    }
    console.log('[main] 백엔드 재기동 요청');
    backendHost.restartBackend();
  });

  // 정비 모드 토글: kiosk/fullscreen 해제 + 프레임·메뉴바 노출. 현재 kiosk 상태를 단일
  // 출처로 삼아 진입/복귀를 한 동작으로 뒤집는다.
  globalShortcut.register('Control+Shift+K', () => {
    const entering = window.isKiosk();
    window.setKiosk(!entering);
    window.setFullScreen(!entering);
    window.setMenuBarVisibility(entering);
    window.setAutoHideMenuBar(!entering);
  });

  if (IS_DEV) {
    window.loadURL(RENDERER_DEV_SERVER_URL);
  } else {
    window.loadFile(rendererIndex());
  }

  if (IS_DEV) {
    window.webContents.openDevTools();
  }
};

// `ready` 핸들러는 등록 순서대로 실행된다. createWindow 가 렌더러 index 를 해석하므로
// 그 전에 세대를 확보해야 한다 — 순서가 뒤면 존재하지 않는 경로를 넘긴다(실측).
onReady(() => {
  if (IS_DEV) return;
  generations.ensureBaselines(UPDATABLE_COMPONENTS);
});

onReady(createWindow);

// 앱 종료 시작을 백엔드 호스트에 알린다 — 알리지 않으면 백엔드 exit 를 크래시로 보고
// 되살리려 하고, 이미 파괴된 창을 배선하려다 메인이 죽는다.
app.on('before-quit', () => backendHost?.shutdown());
onReady(() => {
  powerSaveBlocker.start('prevent-display-sleep');
});
// 백엔드는 자식 프로세스로 띄우고 electron 능력만 빌려준다. 메인 안에 import 하던
// 방식은 교체가 앱 재기동을 요구하고, 무엇을 정리해야 하는지 목록을 사람이 관리해야 했다.
onReady(() => {
  if (IS_DEV) return;

  backendHost = startBackendHost({
    artifactRoot: ARTIFACT_ROOT,
    store: generations,
    records: applyRecords,
    rollbacks,
    resolveBackendEntry: () =>
      path.join(generations.resolveDir(UPDATE_COMPONENT.BACKEND), 'index.js'),
    installBase: (installerPath) =>
      installBaseAndQuit(installerPath, (message) =>
        mainLog('info', `[업데이트] ${message}`),
      ),
    // 파괴된 창의 webContents 는 접근만 해도 throw 한다 — 종료 중에 배선이 돌면
    // 그대로 메인 프로세스가 죽는다(실측: 'Object has been destroyed').
    getWebContents: () =>
      mainWindow && !mainWindow.isDestroyed() && rendererLoadedOnce
        ? mainWindow.webContents
        : null,
    // reload() 는 지금 URL(옛 세대의 index.html)을 그대로 다시 읽는다 — 포인터만 갈리고
    // 화면은 옛 세대로 남는다(실측). 교체 경로는 포인터를 다시 해석해 이동해야 한다.
    reloadRenderer: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (IS_DEV) {
        mainWindow.webContents.reload();
        return;
      }
      // 이동이 겹치면 reject 한다(ERR_ABORTED). 안 잡으면 unhandled rejection 이
      // uncaughtException 으로 올라와 메인이 스스로 종료한다.
      mainWindow
        .loadFile(rendererIndex())
        .catch((error: unknown) =>
          mainLog(
            'error',
            `렌더러 재적재 실패: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    },
  });
});

// macOS 는 창을 다 닫아도 앱이 살아 있는 것이 관례다.
app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
