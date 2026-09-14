import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, context } from 'esbuild';
import { copy } from 'esbuild-plugin-copy';

const isWatch = process.argv.includes('--watch');
const isDev = process.env.NODE_ENV !== 'production';

const pkgDir = resolve(process.cwd());
const entry = resolve(pkgDir, 'index.ts');
const outdir = resolve(pkgDir, 'dist');

async function run() {
  // esbuild 는 outdir 을 비우지 않는다 — 설정이 바뀌어 더 이상 나오지 않는 산출물이
  // 그대로 남고, 취합(collect)이 dist 를 통째 복사하므로 설치본까지 딸려 간다.
  // 실제로 koffi 를 external 로 돌린 뒤에도 옛 .node 76MB 가 계속 실려 나갔다.
  rmSync(outdir, { recursive: true, force: true });

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
    ],
    // 번들 최상단에 실린다 — `node:sqlite` 가 로드되기 전에 돌아야 하므로 모듈 안에는
    // 둘 수 없다(경고는 다음 tick 에 전달되고, 로더는 그 사이에 이미 flush 한다).
    // 부모가 자식 stderr 를 에러로 미러링하므로, 놔두면 매 부팅마다 가짜 에러가 남는다.
    banner: {
      js: "process.removeAllListeners('warning');process.on('warning',w=>{if(w.name!=='ExperimentalWarning')console.warn(w.stack||w.message)});",
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'development',
      ),
      // 마이그레이션 폴더를 번들 옆에서 찾게 한다. 패키징된 앱의 cwd 는 이 패키지가
      // 아니라서 cwd 기준으로 두면 부팅 때 migrate() 가 폴더를 못 찾고 죽는다.
      __OUTBOX_BUNDLE_DIR__: '__dirname',
    },
    plugins: [
      copy({
        resolveFrom: 'out',
        assets: { from: ['./drizzle/**/*'], to: ['./drizzle'] },
      }),
    ],
    alias: {
      '@': resolve(pkgDir, '../..'),
      '@ipc/Router': isDev
        ? resolve(pkgDir, '../../shared/IPCServer/impl/express-ipc.ts')
        : resolve(pkgDir, '../../shared/IPCServer/impl/electron.ts'),
      // node·bridge 두 토폴로지 모두 부모가 자식 stdout 을 읽는다 — 로그 파일의
      // 단독 소유자는 백엔드이므로 자식은 파일을 열지 않는다.
      '@log/Sink': resolve(pkgDir, '../../shared/Logger/impl/stdout.ts'),
      // drizzle 의 드라이버가 최상단에서 import 하지만 우리는 클라이언트를 직접
      // 넘기므로 절대 생성되지 않는다 — 네이티브 패키지를 설치할 이유가 없다.
      'better-sqlite3': resolve(pkgDir, 'src/db/betterSqliteStub.ts'),
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
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
