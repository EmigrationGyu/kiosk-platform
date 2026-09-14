import type { ControllerHandlers } from '@/shared/IPCServer/types';
import { Logger } from '@/shared/Logger';
import type { EndpointsMap } from './constants/endpoints';
import { OutboxController } from './controller/OutboxController';
import { closeDb, getDb, runMigrations } from './db/client';
import {
  type CredentialStore,
  createCredentialStore,
} from './executor/credentialStore';
import { GraphQLExecutor } from './executor/GraphQLExecutor';
import { OutboxRouter } from './router/OutboxRouter';
import { OutboxScheduler } from './scheduler/OutboxScheduler';
import { OutboxService } from './service/OutboxService';

type RouteEntry = [OutboxRouter, () => ControllerHandlers<EndpointsMap>];

function routeEntries(app: App): RouteEntry[] {
  return [
    [
      app.outboxRouter,
      () =>
        new OutboxController({
          service: app.service,
          scheduler: app.scheduler,
          credentials: app.credentials,
        }).handlers,
    ],
  ];
}

export class App {
  outboxRouter: OutboxRouter;
  service: OutboxService;
  scheduler: OutboxScheduler;
  credentials: CredentialStore;
  private logger = Logger.getInstance();

  constructor() {
    runMigrations();

    this.credentials = createCredentialStore();
    this.service = new OutboxService({ db: getDb() });
    this.scheduler = new OutboxScheduler({
      service: this.service,
      // 자격은 발사 시점에 읽는다 — 토큰이 갈려도 executor 를 다시 만들 필요가 없다.
      executor: new GraphQLExecutor({
        credentials: () => this.credentials.get(),
      }),
    });
    this.outboxRouter = new OutboxRouter();
  }

  start() {
    this.setupRouters();

    // 라우터를 먼저 세운 뒤 스케줄러를 켠다 — start() 가 resetInFlight 로 부팅 복구를
    // 하는 동안에도 백엔드의 DRAIN 이 닿을 수 있어야 한다.
    void this.scheduler.start().catch((e) => {
      this.logger.error('[Outbox:App] scheduler start failed:', e);
    });

    this.logger.info('[Outbox:App] started');
  }

  private setupRouters() {
    for (const [router, getHandlers] of routeEntries(this)) {
      router.serveAll(getHandlers());
    }
  }

  static reload(app: App) {
    for (const [router, getHandlers] of routeEntries(app)) {
      router.replaceHandlers(getHandlers());
    }
  }

  stop() {
    // 타이머부터 세운다 — DB 를 먼저 닫으면 발화 중인 tick 이 닫힌 핸들을 만진다.
    this.scheduler.stop();
    closeDb();
  }
}
