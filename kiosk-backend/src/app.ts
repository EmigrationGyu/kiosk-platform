import { processManager } from '@processManager/Manager';
import type { Namespace } from './constant/Namespaces';
import type { ControllerHandlers } from './controller/BaseController';
import { FileSystemController } from './controller/FileSystemController';
import { HardwareController } from './controller/HardwareController';
import { ImeController } from './controller/ImeController';
import { LogController } from './controller/LogController';
import { OutboxController } from './controller/OutboxController';
import { PermissionController } from './controller/PermissionController';
import { TokenDispenserController } from './controller/TokenDispenserController';
import { UpdateController } from './controller/UpdateController';
import { logContractFingerprint } from './helpers/contractFingerprint';
import { bootstrapOutbox } from './helpers/outboxBootDrain';
import { createSocketServer } from './helpers/socket/Socket';
import { startSupervisorHeartbeat } from './helpers/supervisorHeartbeat';
import { FileSystemRouter } from './router/FileSystemRouter';
import { HardwareRouter } from './router/HardwareRouter';
import { ImeRouter } from './router/ImeRouter';
import { LogRouter } from './router/LogRouter';
import { OutboxRouter } from './router/OutboxRouter';
import { PermissionRouter } from './router/PermissionRouter';
import type { Router } from './router/Router';
import { TokenDispenserRouter } from './router/TokenDispenserRouter';
import { UpdateRouter } from './router/UpdateRouter';
import type { NamespaceEventMap } from './types/Namespaces';
import { startApplyTrigger } from './update/applyTrigger';
import { resumeRollback } from './update/rollback';

// @gen:import

// 내부 표현은 any 로 뭉개지지만, 생성은 반드시 entry() 를 거치므로
// 라우터↔컨트롤러 페어링은 생성 시점에 타입으로 강제된다.
type RouteEntry = [Router<any>, () => ControllerHandlers<any>];

// 라우터와 컨트롤러의 네임스페이스가 어긋나면 여기서 컴파일 에러가 난다.
function entry<N extends Namespace>(
  router: Router<N>,
  getHandlers: () => ControllerHandlers<NamespaceEventMap[N]>,
): RouteEntry {
  return [router, getHandlers];
}

function routeEntries(app: App): RouteEntry[] {
  return [
    entry(app.hardwareRouter, () => new HardwareController().handlers),
    entry(app.logRouter, () => new LogController().handlers),
    entry(app.permissionRouter, () => new PermissionController().handlers),
    entry(app.filesystemRouter, () => new FileSystemController().handlers),
    entry(app.imeRouter, () => new ImeController().handlers),
    entry(
      app.tokenDispenserRouter,
      () => new TokenDispenserController().handlers,
    ),
    [app.updateRouter, () => new UpdateController().handlers],
    [app.outboxRouter, () => new OutboxController().handlers],
    // @gen:serve
  ];
}

export class App {
  hardwareRouter: HardwareRouter;
  logRouter: LogRouter;
  permissionRouter: PermissionRouter;
  filesystemRouter: FileSystemRouter;
  imeRouter: ImeRouter;
  tokenDispenserRouter: TokenDispenserRouter;
  updateRouter: UpdateRouter;
  outboxRouter: OutboxRouter;
  // @gen:field

  constructor() {
    this.hardwareRouter = new HardwareRouter();
    this.logRouter = new LogRouter();
    this.permissionRouter = new PermissionRouter();
    this.filesystemRouter = new FileSystemRouter();
    this.imeRouter = new ImeRouter();
    this.tokenDispenserRouter = new TokenDispenserRouter();
    this.updateRouter = new UpdateRouter();
    this.outboxRouter = new OutboxRouter();
    // @gen:init
  }

  private setupRouters() {
    for (const [router, getHandlers] of routeEntries(this)) {
      router.serveAll(getHandlers());
    }
  }

  static reload(app: App) {
    for (const [router, getHandlers] of routeEntries(app)) {
      router.reload(getHandlers());
    }
  }

  async start() {
    // 이 번들이 어느 계약으로 빌드됐는지 남긴다. 서브프로세스도 같은 줄을 자기 로그에
    // 찍으므로, 원격 부분 업데이트로 컴포넌트가 갈리면 로그 비교만으로 드러난다.
    logContractFingerprint();

    // 클라이언트가 붙기 전에 라우트를 세운다.
    this.setupRouters();

    // EAGER 서브프로세스를 띄운다. impl 모듈 최상위에서 부르면 안 된다 — ESM 은 import 를
    // 엔트리 본문보다 먼저 평가하므로, bridge 타깃에서 spawn 이 setBridgeClient 전에 돌아
    // 부팅이 죽는다(패키징에서 실측).
    processManager.startEager();

    // 자격을 넘기고 밀린 큐를 깨운다 — 부팅 시점에 이미 보낼 것이 쌓여 있을 수 있다.
    bootstrapOutbox();

    if (process.env.NODE_ENV === 'development') {
      createSocketServer();
    } else {
      // 프로덕션에서만 supervisor daemon 에 heartbeat 송신 (개발 환경엔 daemon 부재).
      startSupervisorHeartbeat();
      // 설치본을 넘은 롤백의 나머지 절반 — 다시 뜬 우리가 마무리한다. 트리거보다 **먼저**:
      // 뒤에 두면 트리거가 방금 쓴 intent 를 "설치본이 다르다"며 폐기한다(실측).
      resumeRollback();
      startApplyTrigger();
    }
  }
}
