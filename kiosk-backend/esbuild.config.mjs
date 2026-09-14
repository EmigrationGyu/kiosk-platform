import { resolve } from 'node:path';
import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isDev = process.env.NODE_ENV !== 'production';

// `--node`: 백엔드가 독립 프로세스로 도는 타깃(개발·pm2). 개발 빌드와 impl 은 같고
// 프로덕션 최적화만 다르다.
const isNodeBuild = process.argv.includes('--node');
const useNodeImpl = isDev || isNodeBuild;
/**
 * 백엔드는 **어느 타깃에서도 electron 을 참조하지 않는다.**
 *
 * - `bridge`: electron 메인의 자식 프로세스. 능력은 부모가 브리지로 빌려준다(프로덕션)
 * - `node`  : 독립 프로세스. 자식을 직접 띄운다(개발·pm2)
 *
 * 과거엔 백엔드를 메인 안에 import 하는 `electron` 타깃이 있었으나, 그 토폴로지에서는
 * 백엔드 교체가 앱 재기동을 요구하고 무엇을 정리해야 하는지 목록을 사람이 관리해야 했다.
 */
const TARGET = useNodeImpl ? 'node' : 'bridge';

/** 타깃별 환경 구현 — 중첩 삼항 대신 표로 두어 타깃이 늘어도 읽힌다. */
const IMPL = {
  node: {
    bridge: './src/bridge/impl/absent.ts',
    channel: './src/helpers/channel/impl/socket.ts',
    storage: './src/helpers/storage/impl/keytar.ts',
    transport: './src/hardwareTransport/impl/express-ipc.ts',
    platform: './src/platform/impl/node.ts',
    manager: './src/processManager/impl/node.ts',
  },
  bridge: {
    bridge: './src/bridge/impl/parent.ts',
    channel: './src/helpers/channel/impl/messagePort.ts',
    storage: './src/helpers/storage/impl/bridge.ts',
    transport: './src/hardwareTransport/impl/postMessage.ts',
    platform: './src/platform/impl/bridge.ts',
    manager: './src/processManager/impl/bridge.ts',
  },
}[TARGET];

/**
 * electron 참조 금지 게이트 — 남아있으면 어느 파일인지 짚어 빌드를 실패시킨다.
 *
 * 백엔드는 이제 어느 타깃에서도 electron 메인 안에서 돌지 않는다. electron 능력이
 * 필요하면 브리지로 빌려야 하며, 직접 import 하는 순간 프로세스 경계가 깨진다.
 */
const forbidElectron = {
  name: 'forbid-electron',
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, (args) => ({
      errors: [
        {
          text: `백엔드에 electron import 가 남아있다 (from: ${args.importer})`,
          notes: [
            {
              text: 'electron 능력은 부모에게 브리지로 빌린다 — BRIDGE_METHOD 참고. 직접 import 는 프로세스 경계를 깨뜨린다.',
            },
          ],
        },
      ],
    }));
  },
};

const pkgDir = resolve(process.cwd());
// 자식 프로세스 타깃은 부모와의 연결을 먼저 세우고 App 을 만들어야 해서 엔트리가 다르다.
const entry = resolve(pkgDir, useNodeImpl ? 'index.ts' : 'index.bridge.ts');
// node 타깃 산출물은 배포본과 섞이지 않게 별도 디렉토리로 뺀다.
const outdir = resolve(pkgDir, isNodeBuild ? 'dist-node' : 'dist');

async function run() {
  const options = {
    entryPoints: [entry],
    outdir,
    // 산출물 이름을 엔트리 파일명과 분리한다 — 프로덕션은 index.bridge.ts 를 쓰지만
    // 소비처(componentSegments)가 가리키는 경로는 항상 index.js 다.
    entryNames: 'index',
    platform: 'node',
    format: 'cjs',
    bundle: true,
    sourcemap: isDev,
    target: 'node20',
    logLevel: 'info',
    tsconfig: resolve(pkgDir, './tsconfig.json'),
    // 어느 타깃이든 electron 참조는 금지다 — 백엔드는 더 이상 메인 안에서 돌지 않는다.
    plugins: [forbidElectron],
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
      // 네이티브 모듈은 번들하지 않음
      'serialport',
      'keytar',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'development',
      ),
      'process.env.MOBILE_ID_API_HOST': JSON.stringify(
        process.env.MOBILE_ID_API_HOST || '',
      ),
      'process.env.MOBILE_ID_SERVICE_CODE': JSON.stringify(
        process.env.MOBILE_ID_SERVICE_CODE || '',
      ),
      'process.env.ARTIFACT_BASE_URL': JSON.stringify(
        process.env.ARTIFACT_BASE_URL || '',
      ),
      'process.env.AUDIO_CDN_BASE_URL': JSON.stringify(
        process.env.AUDIO_CDN_BASE_URL || '',
      ),
      // 서브프로세스가 직접 서버를 치는 경로가 있어 백엔드도 이 주소를 안다.
      // 렌더러와 **같은 서버**라 VITE_API_HOST 를 그대로 쓴다 — 운영이 관리할 값을
      // 둘로 늘리면 한쪽만 바뀌어 어긋난다. CI 는 이미 모든 컴포넌트 빌드에 넘긴다.
      'process.env.API_HOST': JSON.stringify(
        process.env.API_HOST || process.env.VITE_API_HOST || '',
      ),
    },
    alias: {
      '@': resolve(pkgDir, '../..'),
      '@bridge/Bridge': resolve(pkgDir, IMPL.bridge),
      '@channel/Channel': resolve(pkgDir, IMPL.channel),
      '@storage/SecureStorage': resolve(pkgDir, IMPL.storage),
      '@hardwareTransport/Transport': resolve(pkgDir, IMPL.transport),
      '@platform/Platform': resolve(pkgDir, IMPL.platform),
      '@processManager/Manager': resolve(pkgDir, IMPL.manager),
      // 빌드 산출물은 실물. SERIAL_LOOPBACK=1 로 데모 빌드를 만들 수 있다.
      '@serial/Port': resolve(
        pkgDir,
        process.env.SERIAL_LOOPBACK === '1'
          ? './src/serialPortScanner/impl/loopback.ts'
          : './src/serialPortScanner/impl/real.ts',
      ),
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
  console.error(err);
  process.exit(1);
});
