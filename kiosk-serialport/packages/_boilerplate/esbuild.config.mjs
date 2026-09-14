import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, context } from 'esbuild';

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
      // 빌드 산출물은 실물 — 루프백은 dev 전용이다. SERIAL_LOOPBACK=1 로 강제하면
      // 실장비 없는 데모 빌드를 만들 수 있다.
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
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
