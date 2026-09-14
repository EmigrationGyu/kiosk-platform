import { join } from 'node:path';
import { insertBeforeMarker, writeNew } from '../fsutil';
import type { Names } from '../naming';
import { BACKEND } from '../paths';

// ── fb: 소켓 도메인 ────────────────────────────────────

/**
 * fb — 컨트롤러/라우터/이벤트 re-export + app·Namespaces 와이어링 (서비스 제외).
 * 정의는 types 에서 re-export 만 한다.
 */
export async function emitFbBackendWiring(n: Names): Promise<void> {
  console.log('• backend (kiosk-backend) — socket');
  const src = join(BACKEND, 'src');

  // 이벤트 re-export (백엔드 라우터는 요청만 검증 → ResponseSchemas 불필요)
  await writeNew(
    join(src, 'constant', 'events', `${n.pascal}.ts`),
    `export {
  ${n.screaming}_EVENTS,
  ${n.pascal}Schemas,
  type ${n.pascal}EventMap,
} from 'kiosk-types';
`,
  );

  // 컨트롤러 (withErrorHandler 합성)
  await writeNew(
    join(src, 'controller', `${n.pascal}Controller.ts`),
    `import { SUCCESS_CODE } from '../constant/SuccessCodes';
import {
  ${n.screaming}_EVENTS,
  type ${n.pascal}EventMap,
} from '../constant/events/${n.pascal}';
import { ${n.pascal}Service } from '../service/${n.pascal}Service';
import { withErrorHandler } from '../utils/errorHandler';
import { BaseController, type ControllerHandlers } from './BaseController';

export class ${n.pascal}Controller extends BaseController<${n.pascal}EventMap> {
  private ${n.camel}Service: ${n.pascal}Service = new ${n.pascal}Service();

  constructor() {
    const handlers = {
      [${n.screaming}_EVENTS.PING]: withErrorHandler(async (_req, res) => {
        const pong = await this.${n.camel}Service.ping();
        return res.ok(SUCCESS_CODE.OK, pong);
      }, 'Failed to ping ${n.kebab}'),
    } satisfies ControllerHandlers<${n.pascal}EventMap>;

    super(handlers);
  }
}
`,
  );

  // 라우터
  await writeNew(
    join(src, 'router', `${n.pascal}Router.ts`),
    `import { Router } from './Router';
import { NAMESPACES } from '../constant/Namespaces';
import { ${n.pascal}Schemas } from '../constant/events/${n.pascal}';

export class ${n.pascal}Router extends Router<typeof NAMESPACES.${n.screaming}> {
  constructor() {
    super(NAMESPACES.${n.screaming}, ${n.pascal}Schemas);
  }
}
`,
  );

  // 네임스페이스 enum 은 kiosk-types/src/namespaces.ts(SSOT)에 emitFbTypes 가 주입한다.
  // backend/src/constant/Namespaces.ts 는 순수 re-export 라 여기서 주입하지 않는다.

  // types/Namespaces.ts — import / NamespaceEventMap / namespaceToEvents
  const nsTypes = join(src, 'types', 'Namespaces.ts');
  await insertBeforeMarker(
    nsTypes,
    'import',
    `import {\n  ${n.screaming}_EVENTS,\n  type ${n.pascal}EventMap,\n} from 'src/constant/events/${n.pascal}';`,
    `events/${n.pascal}';`,
  );
  await insertBeforeMarker(
    nsTypes,
    'nsmap',
    `[NAMESPACES.${n.screaming}]: ${n.pascal}EventMap;`,
  );
  await insertBeforeMarker(
    nsTypes,
    'ns-events',
    `[NAMESPACES.${n.screaming}]: Object.values(${n.screaming}_EVENTS),`,
  );

  // app.ts — import / field / init / serve
  const app = join(src, 'app.ts');
  await insertBeforeMarker(
    app,
    'import',
    `import { ${n.pascal}Controller } from './controller/${n.pascal}Controller';\nimport { ${n.pascal}Router } from './router/${n.pascal}Router';`,
    `./controller/${n.pascal}Controller`,
  );
  await insertBeforeMarker(
    app,
    'field',
    `${n.camel}Router: ${n.pascal}Router;`,
  );
  await insertBeforeMarker(
    app,
    'init',
    `this.${n.camel}Router = new ${n.pascal}Router();`,
  );
  await insertBeforeMarker(
    app,
    'serve',
    `[app.${n.camel}Router, () => new ${n.pascal}Controller().handlers],`,
  );
}

/** fb 단독 모드용 서비스 스텁 (무상태, ping → 'pong'). */
export async function emitFbBackendService(n: Names): Promise<void> {
  await writeNew(
    join(BACKEND, 'src', 'service', `${n.pascal}Service.ts`),
    `export class ${n.pascal}Service {
  async ping(): Promise<'pong'> {
    return 'pong';
  }
}
`,
  );
}

export async function emitFbBackend(n: Names): Promise<void> {
  await emitFbBackendWiring(n);
  await emitFbBackendService(n);
}

// ── bs: 하드웨어 트랜스포트 ────────────────────────────

/** bs — IPC 트랜스포트 싱글턴 + events re-export(응답 스키마/EventMap) (서비스 제외). */
export async function emitBsBackendTransport(n: Names): Promise<void> {
  console.log('• backend (kiosk-backend) — hardwareTransport');
  const src = join(BACKEND, 'src');

  // 이벤트·스키마는 types 단일 출처를 re-export 한다(하드코딩 X).
  await writeNew(
    join(src, 'hardwareTransport', 'events', `${n.pascal}.ts`),
    `export {
  ${n.screaming}_PIPE_PATH,
  ${n.screaming}_ENDPOINTS as ${n.screaming}_EVENTS,
  ${n.pascal}SerialResponseSchemas as ${n.pascal}Schemas,
  type ${n.pascal}SerialEventMap as ${n.pascal}EventMap,
} from 'kiosk-types';
`,
  );

  await writeNew(
    join(src, 'hardwareTransport', `${n.pascal}.ts`),
    `import { Transport } from '@hardwareTransport/Transport';
import { SERIALPORT_PROCESS } from 'kiosk-types';
import { ${n.pascal}Schemas } from './events/${n.pascal}';
import type { ${n.pascal}EventMap } from './events/${n.pascal}';

export class ${n.pascal} extends Transport<${n.pascal}EventMap> {
  private static instance: ${n.pascal} | undefined;
  private constructor() {
    // 프로세스 **식별자**를 넘긴다 — 실제 경로(pipe·fork entry)는 환경별 impl 이 정한다.
    super(SERIALPORT_PROCESS.${n.screaming}, ${n.pascal}Schemas);
  }

  public static getInstance(): ${n.pascal} {
    if (!${n.pascal}.instance) {
      ${n.pascal}.instance = new ${n.pascal}();
    }
    return ${n.pascal}.instance;
  }
}
`,
  );

  // HardwareController — 프리웜(WARMUP) 전략 편입. emitBsTypes 가 WARMABLE_PROCESSES
  // 에 추가한 항목과 짝이다(satisfies 닫힌 집합이라 한쪽만 주입되면 컴파일 에러).
  // 시드 전략은 HEALTH_CHECK 왕복 — 스캐너 관할(ensureDevice)로 승격은 수동 결정.
  const hardwareController = join(src, 'controller', 'HardwareController.ts');
  await insertBeforeMarker(
    hardwareController,
    'warmup-import',
    `import { ${n.screaming}_EVENTS } from '../hardwareTransport/events/${n.pascal}';\nimport { ${n.pascal} } from '../hardwareTransport/${n.pascal}';`,
    `from '../hardwareTransport/${n.pascal}';`,
  );
  await insertBeforeMarker(
    hardwareController,
    'warmup-strategy',
    `[SERIALPORT_PROCESS.${n.screaming}]: () =>
  ${n.pascal}.getInstance().request(${n.screaming}_EVENTS.HEALTH_CHECK),`,
    `[SERIALPORT_PROCESS.${n.screaming}]:`,
  );
}

/** bs 단독 모드용 서비스 스텁 (healthCheck → 트랜스포트). */
export async function emitBsBackendService(n: Names): Promise<void> {
  await writeNew(
    join(BACKEND, 'src', 'service', `${n.pascal}Service.ts`),
    `import { ${n.screaming}_EVENTS } from '../hardwareTransport/events/${n.pascal}';
import { ${n.pascal} } from '../hardwareTransport/${n.pascal}';

export class ${n.pascal}Service {
  private ${n.camel}: ${n.pascal} = ${n.pascal}.getInstance();

  async healthCheck(): Promise<void> {
    await this.${n.camel}.request(${n.screaming}_EVENTS.HEALTH_CHECK);
  }
}
`,
  );
}

export async function emitBsBackend(n: Names): Promise<void> {
  await emitBsBackendTransport(n);
  await emitBsBackendService(n);
}

// ── full: 병합 서비스 ──────────────────────────────────

/**
 * full — fb 컨트롤러가 쓰는 단일 서비스가 bs 하드웨어 트랜스포트도 호출한다.
 * front→back→hardware 글루의 자리. (fb·bs 의 분리된 서비스 스텁을 대체)
 */
export async function emitFullBackendService(n: Names): Promise<void> {
  await writeNew(
    join(BACKEND, 'src', 'service', `${n.pascal}Service.ts`),
    `import { ${n.screaming}_EVENTS } from '../hardwareTransport/events/${n.pascal}';
import { ${n.pascal} } from '../hardwareTransport/${n.pascal}';

export class ${n.pascal}Service {
  private ${n.camel}: ${n.pascal} = ${n.pascal}.getInstance();

  // 프론트 PING → 하드웨어 HEALTH_CHECK 위임 (front→back→hardware 글루 예시)
  async ping(): Promise<'pong'> {
    await this.${n.camel}.request(${n.screaming}_EVENTS.HEALTH_CHECK);
    return 'pong';
  }
}
`,
  );
}
