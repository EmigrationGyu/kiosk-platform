import { join } from 'node:path';
import { writeNew } from '../fsutil';
import type { Names } from '../naming';
import { SERIALPORT } from '../paths';

/**
 * bs 모드 — kiosk-serialport/packages/{kebab} 서브프로세스 패키지를 스캐폴드한다.
 * 현행 패키지(cash-dispenser)를 미러하되, endpoints 는 types re-export, 컨트롤러는
 * withErrorHandler 합성을 사용한다. (stale 한 _boilerplate 디렉토리는 미사용)
 */
export async function emitSerialportPackage(n: Names): Promise<void> {
  console.log('• serialport (kiosk-serialport)');
  const pkg = join(SERIALPORT, 'packages', n.kebab);

  await writeNew(
    join(pkg, 'package.json'),
    `{
  "name": "${n.kebab}",
  "main": "dist/index.js",
  "type": "commonjs",
  "private": true,
  "scripts": {
    "start": "npm run start:dev",
    "start:dev": "cross-env NODE_ENV=development vite-node --watch ./index.ts",
    "start:prod": "cross-env NODE_ENV=production vite-node --watch ./index.ts",
    "build": "npm run build:prod",
    "build:prod": "cross-env NODE_ENV=production bun esbuild.config.mjs",
    "build:dev": "cross-env NODE_ENV=development bun esbuild.config.mjs",
    "build:watch": "cross-env NODE_ENV=development bun esbuild.config.mjs --watch"
  },
  "exports": "./dist/index.js",
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5"
  },
  "version": "0.0.1-0"
}
`,
  );

  await writeNew(
    join(pkg, 'tsconfig.json'),
    `{
  "extends": "../../tsconfig.json",
  "include": ["**/*.ts", "**/*.tsx", "../../shared/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
`,
  );

  await writeNew(
    join(pkg, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../..'),
      '@ipc/Router': resolve(
        __dirname,
        '../../shared/IPCServer/impl/express-ipc.ts',
      ),
      // 부모가 stdout 을 읽는 토폴로지 — 로그 파일은 백엔드가 단독으로 소유한다.
      '@log/Sink': resolve(__dirname, '../../shared/Logger/impl/stdout.ts'),
      // dev 기본값은 루프백 — 하드웨어 없이 전 스택이 돈다.
      '@serial/Port': resolve(
        __dirname,
        '../../shared/SerialPort/impl/loopback.ts',
      ),
    },
  },
  ssr: {
    external: ['serialport', '@serialport/*', 'express-ipc'],
  },
});
`,
  );

  await writeNew(
    join(pkg, 'esbuild.config.mjs'),
    `import { build, context } from 'esbuild';
import { resolve } from 'node:path';

const isWatch = process.argv.includes('--watch');
const isDev = process.env.NODE_ENV !== 'production';

const pkgDir = resolve(process.cwd());
const entry = resolve(pkgDir, 'index.ts');
const outdir = resolve(pkgDir, 'dist');

async function run() {
  const options = {
    entryPoints: [entry],
    outdir,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    sourcemap: isDev,
    target: 'es2022',
    logLevel: 'info',
    tsconfig: resolve(pkgDir, '../../tsconfig.json'),
    legalComments: 'none',
    minify: !isDev,
    keepNames: isDev,
    splitting: false,
    outbase: pkgDir,
    external: [
      'fs',
      'path',
      'os',
      'crypto',
      'stream',
      'events',
      'http',
      'https',
      'url',
      'zlib',
      'util',
      'tty',
      'assert',
      'buffer',
      'readline',
      'net',
      'tls',
      'child_process',
      'serialport',
      '@serialport/*',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'development',
      ),
    },
    alias: {
      '@': resolve(pkgDir, '../..'),
      '@ipc/Router': isDev
        ? resolve(pkgDir, '../../shared/IPCServer/impl/express-ipc.ts')
        : resolve(pkgDir, '../../shared/IPCServer/impl/electron.ts'),
      // node·bridge 두 토폴로지 모두 부모가 자식 stdout 을 읽는다 — 로그 파일의
      // 단독 소유자는 백엔드이므로 자식은 파일을 열지 않는다.
      '@log/Sink': resolve(pkgDir, '../../shared/Logger/impl/stdout.ts'),
      // 빌드 산출물은 실물. SERIAL_LOOPBACK=1 로 데모 빌드를 만들 수 있다.
      '@serial/Port': resolve(
        pkgDir,
        process.env.SERIAL_LOOPBACK === '1'
          ? '../../shared/SerialPort/impl/loopback.ts'
          : '../../shared/SerialPort/impl/real.ts',
      ),
    },
    loader: {
      '.node': 'file',
    },
  };

  if (isWatch) {
    const ctx = await context(options);
    await ctx.watch();
    await ctx.serve?.();
  } else {
    await build(options);
  }
}

run().catch((err) => {
  const msg = err && err.stack ? String(err.stack) : String(err);
  process.stderr.write(\`\${msg}\\n\`);
  process.exit(1);
});
`,
  );

  await writeNew(
    join(pkg, 'vite-env.d.ts'),
    `/// <reference types="vite/client" />\n`,
  );

  await writeNew(
    join(pkg, 'index.ts'),
    `import { SERIALPORT_PROCESS } from 'kiosk-types';
import { logContractFingerprint } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import { App } from './src/app';

// 정체 신고가 라우터보다 먼저다 — Router 는 응답 봉투에 자기 표면 지문(ownSurface)을 싣는데,
// 신고 없이 start() 하면 등록 시점에 즉시 throw 한다(조용히 승격 근거에서 빠지는 것보다 낫다).
Logger.getInstance(SERIALPORT_PROCESS.${n.screaming});
logContractFingerprint(SERIALPORT_PROCESS.${n.screaming});

if (import.meta.hot) {
  if (!import.meta.hot.data.app) {
    const app = new App();
    app.start();
    import.meta.hot.data.app = app;
    console.log('[ready]');
  } else {
    App.reload(import.meta.hot.data.app);
  }

  import.meta.hot.accept();
} else {
  new App().start();
  console.log('[ready]');
}
`,
  );

  await writeNew(
    join(pkg, 'src', 'app.ts'),
    `import type { ControllerHandlers } from '@/shared/IPCServer/types';
import type { EndpointsMap } from './constants/endpoints';
import { ${n.pascal}Controller } from './controller/${n.pascal}Controller';
import { ${n.pascal}Router } from './router/${n.pascal}Router';

type RouteEntry = [${n.pascal}Router, () => ControllerHandlers<EndpointsMap>];

function routeEntries(app: App): RouteEntry[] {
  return [[app.${n.camel}Router, () => new ${n.pascal}Controller().handlers]];
}

export class App {
  ${n.camel}Router: ${n.pascal}Router;

  constructor() {
    this.${n.camel}Router = new ${n.pascal}Router();
  }

  start() {
    this.setupRouters();
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
}
`,
  );

  await writeNew(
    join(pkg, 'src', 'constants', 'endpoints.ts'),
    `export {
  ${n.screaming}_ENDPOINTS as ENDPOINTS,
  ${n.pascal}SerialSchemas as ${n.pascal}Schemas,
  type ${n.pascal}SerialEventMap as EndpointsMap,
} from 'kiosk-types';
`,
  );

  await writeNew(
    join(pkg, 'src', 'router', `${n.pascal}Router.ts`),
    `import { Router } from '@ipc/Router';
import { ${n.screaming}_PIPE_PATH } from 'kiosk-types';
import type { EndpointsMap } from '../constants/endpoints';
import { ${n.pascal}Schemas } from '../constants/endpoints';

export class ${n.pascal}Router extends Router<EndpointsMap> {
  constructor() {
    super(${n.screaming}_PIPE_PATH, ${n.pascal}Schemas);
  }
}
`,
  );

  await writeNew(
    join(pkg, 'src', 'controller', `${n.pascal}Controller.ts`),
    `import { BaseController } from '@/shared/IPCServer/Controller';
import { withErrorHandler } from '@/shared/IPCServer/errorHandler';
import type { ControllerHandlers } from '@/shared/IPCServer/types';
import { Logger } from '@/shared/Logger';
import { ENDPOINTS, type EndpointsMap } from '../constants/endpoints';
import { SerialPortService } from '../service/SerialPortService';

// 직렬화가 필요한 커맨드 엔드포인트를 추가하면 createSerialMutex 합성을 사용하세요:
//   import { createSerialMutex } from '@/shared/IPCServer/serialMutex';
//   private withMutex = createSerialMutex('${n.pascal}:Controller');
export class ${n.pascal}Controller extends BaseController<EndpointsMap> {
  private serialPortService = new SerialPortService();
  private logger = Logger.getInstance();

  constructor() {
    const handlers = {
      [ENDPOINTS.PORT_ASSIGNED]: withErrorHandler(async (req, res) => {
        // 값은 메시지에 보간하지 않고 meta 로 넘긴다 — 상수 메시지여야 로그 가드를
        // 통과하고, 값이 필드로 남아야 나중에 그 줄을 필드로 찾을 수 있다.
        this.logger.info('[${n.pascal}:Controller] PORT_ASSIGNED', {
          unmasked: { portPath: req.portPath },
        });
        await this.serialPortService.connect({
          portPath: req.portPath,
          serialOptions: req.serialOptions,
        });
        return res.ok(200);
      }, 'Failed to assign port to ${n.kebab}'),
      // 백엔드 스캐너의 재탐지 전제조건 — 이 응답 이후 포트는 스캐너가 열 수 있다.
      // 뮤텍스를 도입했다면 이 핸들러도 반드시 통과시킬 것(진행 중 연산 중간에 포트를 뺏지 않기 위함).
      [ENDPOINTS.RELEASE_PORT]: withErrorHandler(async (_req, res) => {
        this.logger.info(\`[${n.pascal}:Controller] RELEASE_PORT\`);
        await this.serialPortService.disconnect();
        return res.ok(200);
      }, 'Failed to release port of ${n.kebab}'),
      [ENDPOINTS.HEALTH_CHECK]: withErrorHandler(async (_req, res) => {
        await this.serialPortService.healthCheck();
        return res.ok(200);
      }, 'Failed to health check ${n.kebab}'),
    } satisfies ControllerHandlers<EndpointsMap>;

    super(handlers);
  }
}
`,
  );

  await writeNew(
    join(pkg, 'src', 'service', 'SerialPortService.ts'),
    `import { ManagedSerialPort } from '@/shared/SerialPort/ManagedSerialPort';
import type { SerialPortConnectionInfo } from '@/shared/SerialPort/types';

export class SerialPortService {
  private readonly managedPort = ManagedSerialPort.shared(
    () => new ManagedSerialPort(),
  );

  async connect({ portPath, serialOptions }: SerialPortConnectionInfo) {
    await this.managedPort.connect({ portPath, serialOptions });
  }

  /** 포트 소유권 반납 — 백엔드 스캐너가 이 포트를 직접 열어 재탐지할 수 있게 한다(멱등). */
  async disconnect() {
    await this.managedPort.disconnect();
  }

  async healthCheck() {
    // TODO: 디바이스의 헬스체크 커맨드 송신 + 응답 검증 구현
  }
}
`,
  );
}
