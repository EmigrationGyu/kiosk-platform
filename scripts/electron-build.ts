#!/usr/bin/env bun
/**
 * 로컬 일렉트론 빌드 파이프라인 (공유 코어) — CI(release-full.yml)의 로컬 미러.
 *
 * make.ts / package.ts 가 이 코어를 호출한다. 두 진입점의 차이는 마지막 electron
 * 단계뿐이다:
 *   - make    → electron-forge make    (설치 파일/배포물 — out/make)
 *   - package → electron-forge package (패키징된 앱만   — out)
 * 그 앞단계(서브레포 빌드 + dist 취합)는 완전히 동일하므로 여기로 추출한다.
 *
 *   bun run make | package               # prod 빌드 → 취합 → electron make|package
 *   bun run make | package --dev         # dev 빌드  → 취합 → make:dev|package:dev
 *   bun run make | package --skip-build  # 빌드 생략, 기존 dist 만 취합 + 실행
 *
 * CI 는 각 서브레포의 dist 를 S3 에 올리고, 일렉트론 잡이 그것을 내려받아
 * kiosk-electron/target/ 으로 취합한 뒤 electron 을 돌린다. 로컬엔 의존성이
 * 이미 전부 있으므로 S3 왕복이 필요 없다 — 각 레포를 빌드하고, dist 를 target 으로
 * 직접 복사한 뒤, electron make|package 를 실행한다.
 *
 * ── 빌드 스케줄링: frontend 단독 레인 ────────────────────────────
 * frontend(rolldown, 12k+ 모듈·react-compiler·lottie-sanitize)는 CPU 를 통째로 쓰는
 * 무거운 빌드다. backend + serialport(전부 esbuild, 각 GOMAXPROCS 스레드)와 한꺼번에
 * 병렬로 돌리면 12코어가 70~80 스레드로 과구독돼 frontend 가 굶는다. 그래서:
 *   1) 경량 esbuild 그룹(backend + serialport)을 병렬로 먼저 돌리고,
 *   2) frontend 는 머신을 독점한 상태에서 돌리되, 그 안에서 tsc 타입체크와 vite 번들을
 *      동시에 겹친다 — 둘은 독립적이고(tsc 는 noEmit) 자원 프로파일이 상보적(tsc≈1코어 /
 *      vite≈전코어)이라 경합 없이 직렬 게이트를 ~절반으로 줄인다. (frontend package.json 의
 *      typecheck / build:bundle[:dev] 스크립트를 호출 — build 는 CI 용으로 유지.)
 * (계측은 아래 타이밍 요약으로 출력 — cold/warm·경합 영향을 수치로 확인할 수 있다.)
 *
 * ── 시리얼포트 서브패키지 자동 포함 ──────────────────────────────
 * 빌드/취합 대상 시리얼포트 패키지는 kiosk-serialport/packages/* 를 스캔해
 * 동적으로 결정한다(아래 discoverSerialportPackages 참고). 따라서 `bun gen bs|full`
 * 로 새 디바이스 패키지를 만들면 이 스크립트가 별도 수정 없이 자동으로 잡아낸다.
 * (dev.ts·spawnChildProcesses.ts 의 // @gen:* 마커 주입과 달리, 여기선 마커가 필요 없다.)
 *
 * 주의: target/ 하위에서 이 스크립트가 소유하는 것은 backend/frontend index 와
 * serialport/{pkg}/index 뿐이다. node_modules(koffi 등)·supremaModules·
 * utility-bootstrap.js 는 forge.config.ts 가 실행 시점에 다시 채우므로,
 * 여기서 해당 디렉토리를 비워도 안전하다. (types 는 소스 그대로 소비되어 빌드 불필요.)
 */
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_VERSION_FILE } from '../kiosk-types/src/update/artifact';

/** electron 최종 단계 — make(설치 파일) 또는 package(패키징된 앱) */
export type ElectronTarget = 'make' | 'package';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'kiosk-backend');
const FRONTEND = join(ROOT, 'kiosk-frontend');
const SERIALPORT = join(ROOT, 'kiosk-serialport');
const ELECTRON = join(ROOT, 'kiosk-electron');
const TARGET = join(ELECTRON, 'target');

const IS_WIN = process.platform === 'win32';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
const SP_PALETTE = [C.cyan, C.magenta, C.yellow, C.green, C.blue];

const rel = (p: string): string => p.slice(ROOT.length + 1).replace(/\\/g, '/');

/** ms → 사람이 읽기 쉬운 표기 (1초 미만은 ms, 이상은 s) */
const fmt = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

function banner(msg: string): void {
  console.log(`\n${C.bold}${C.green}==>${C.reset} ${msg}\n`);
}

/**
 * 빌드/취합할 시리얼포트 패키지를 packages/* 스캔으로 결정한다.
 *  - `_` 접두 디렉토리 제외 (_boilerplate)
 *  - package.json 의 scripts.build 가 있는 것만
 * → 현행 7개(receipt/cash/cardkey/token-dispenser/kovan/ime/outbox)와 정확히 일치하며,
 *   gen 으로 추가되는 패키지는 자동 편입된다.
 */
function discoverSerialportPackages(): string[] {
  const pkgsDir = join(SERIALPORT, 'packages');
  return readdirSync(pkgsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .filter((e) => {
      const pj = join(pkgsDir, e.name, 'package.json');
      if (!existsSync(pj)) return false;
      try {
        const json = JSON.parse(readFileSync(pj, 'utf8'));
        return Boolean(json?.scripts?.build);
      } catch {
        return false;
      }
    })
    .map((e) => e.name)
    .sort();
}

// ── 빌드: 각 레포에서 bun run <task.script> ────────────
type BuildTask = { label: string; color: string; cwd: string; script: string };
type BuildResult = { label: string; ms: number };

function prefixStream(
  stream: NodeJS.ReadableStream | null,
  task: BuildTask,
  isErr: boolean,
): void {
  if (!stream) return;
  const tag = `${task.color}${C.bold}[${task.label}]${C.reset} `;
  const out = isErr ? process.stderr : process.stdout;
  let buf = '';
  stream.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      out.write(`${tag}${line}\n`);
    }
  });
}

function runBuild(task: BuildTask): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    // 현재 스크립트를 실행 중인 bun 바이너리를 직접 사용 — Windows 의 PATH 해소
    // 문제(Git Bash ↔ cmd.exe)를 피한다. dev.ts 의 프론트엔드 spawn 과 동일한 이유.
    const child = spawn(process.execPath, ['run', task.script], {
      cwd: task.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    prefixStream(child.stdout, task, false);
    prefixStream(child.stderr, task, true);
    child.on('error', reject);
    child.on('exit', (code) => {
      const ms = Date.now() - startedAt;
      if (code === 0) {
        console.log(`  ${C.dim}⏱  ${task.label}: ${fmt(ms)}${C.reset}`);
        resolve({ label: task.label, ms });
      } else {
        reject(new Error(`${task.label} 빌드 실패 (exit ${code}, ${fmt(ms)})`));
      }
    });
  });
}

/**
 * 한 페이즈의 빌드들을 병렬 실행하고, 끝까지 기다린 뒤 성공 타이밍/실패를 모아 반환한다.
 * (allSettled 라 하나가 실패해도 나머지 자식 프로세스가 끝날 때까지 기다린다 — 고아 방지.)
 */
async function runBuildPhase(
  tasks: BuildTask[],
): Promise<{ timings: BuildResult[]; failures: Error[]; wallMs: number }> {
  const start = Date.now();
  const settled = await Promise.allSettled(tasks.map((t) => runBuild(t)));
  const wallMs = Date.now() - start;
  const timings: BuildResult[] = [];
  const failures: Error[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') timings.push(r.value);
    else failures.push(r.reason as Error);
  }
  return { timings, failures, wallMs };
}

// ── 취합: {repo}/dist → electron/target/... ─────────────
/**
 * 놓은 사본이 무슨 버전인지 함께 적는다.
 *
 * dist 는 esbuild 번들 하나라 자기 버전을 안 들고 다니고 `package.json` 도 같이 복사되지
 * 않는다. 세대는 디렉토리 이름이 곧 버전이지만 동봉본에는 그런 이름이 없어서, **놓는
 * 사람이 적지 않으면 아무도 모른다** — 키오스크가 서버에 "지금 뭐가 도는지"를 보고할 때
 * 이 값이 필요하다.
 *
 * CI 취합은 S3 에서 받아오므로 거기서도 같은 파일을 남긴다(release-*.yml).
 */
function stampVersion(repoDir: string, dest: string): void {
  try {
    const { version } = JSON.parse(
      readFileSync(join(repoDir, 'package.json'), 'utf-8'),
    ) as { version?: unknown };
    if (typeof version !== 'string' || version.length === 0) return;
    writeFileSync(
      join(dest, BASELINE_VERSION_FILE),
      `${JSON.stringify({ version }, null, 2)}
`,
    );
  } catch {
    // 버전을 못 적어도 빌드는 계속된다 — 그 컴포넌트만 콘솔에서 안 보인다.
  }
}

function collect(
  src: string,
  dest: string,
  label: string,
  repoDir: string,
): void {
  if (!existsSync(src)) {
    throw new Error(
      `${label}: dist 가 없습니다 (${rel(src)}) — 빌드가 실패했거나 --skip-build 로 건너뛴 상태입니다.`,
    );
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  stampVersion(repoDir, dest);
  console.log(`  ${C.green}✓${C.reset} ${label}: ${rel(src)} → ${rel(dest)}`);
}

// ── electron make|package ──────────────────────────────
function runElectron(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], {
      cwd: ELECTRON,
      stdio: 'inherit',
      shell: IS_WIN, // npm 은 Windows 에서 npm.cmd — 셸을 통해 해소
      env: { ...process.env },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`electron ${script} 실패 (exit ${code})`)),
    );
  });
}

/** 페이즈 실패 시 메시지를 찍고 던진다 (취합/electron 단계 진입 차단). */
function abortOnFailures(failures: Error[], target: ElectronTarget): void {
  if (failures.length === 0) return;
  for (const e of failures) {
    console.error(`${C.red}✗${C.reset} ${e.message}`);
  }
  throw new Error(`${failures.length}개 빌드 실패 — 취합/${target} 중단`);
}

/** 마지막에 출력하는 타이밍 요약 테이블. */
function printTimingSummary(opts: {
  buildTimings: BuildResult[];
  lightWallMs: number;
  frontendWallMs: number;
  collectMs: number;
  electronMs: number;
  electronScript: string;
  totalMs: number;
  skipBuild: boolean;
}): void {
  banner('⏱  타이밍 요약');
  const rows: Array<[string, number]> = [];
  for (const t of [...opts.buildTimings].sort((a, b) => b.ms - a.ms)) {
    rows.push([`build: ${t.label}`, t.ms]);
  }
  if (!opts.skipBuild) {
    rows.push(['── light group (parallel wall)', opts.lightWallMs]);
    rows.push(['── frontend lane (tsc∥vite wall)', opts.frontendWallMs]);
  }
  rows.push(['collect', opts.collectMs]);
  rows.push([`electron ${opts.electronScript}`, opts.electronMs]);
  rows.push(['TOTAL (wall)', opts.totalMs]);

  const pad = Math.max(...rows.map(([label]) => label.length));
  for (const [label, ms] of rows) {
    console.log(`  ${label.padEnd(pad)}  ${fmt(ms)}`);
  }
}

/**
 * 빌드 → 취합 → electron(target) 파이프라인을 실행한다.
 * make.ts / package.ts 의 단일 진입점. 실패 시 비0 코드로 종료한다.
 */
export async function runElectronPipeline(
  target: ElectronTarget,
): Promise<void> {
  try {
    // ── CLI 옵션 (각 진입점이 argv 를 그대로 위임) ──
    const args = process.argv.slice(2);
    const dev = args.includes('--dev');
    const skipBuild = args.includes('--skip-build');
    const buildScript = dev ? 'build:dev' : 'build'; // 각 레포 package.json 스크립트
    const electronScript = dev ? `${target}:dev` : target; // electron package.json 스크립트
    const outDir = target === 'make' ? join('out', 'make') : 'out';

    const serialports = discoverSerialportPackages();

    banner(`로컬 electron ${target} — mode=${dev ? 'dev' : 'prod'}`);
    console.log(`  serialport 패키지(자동 감지): ${serialports.join(', ')}`);

    const totalStart = Date.now();
    const buildTimings: BuildResult[] = [];
    let lightWallMs = 0;
    let frontendWallMs = 0;

    // 1/3 빌드 — 경량 esbuild 그룹(병렬) → frontend(단독)
    if (skipBuild) {
      banner('1/3 빌드 생략 (--skip-build)');
    } else {
      const lightTasks: BuildTask[] = [
        { label: 'backend', color: C.green, cwd: BACKEND, script: buildScript },
        ...serialports.map((name, i) => ({
          label: name,
          color: SP_PALETTE[i % SP_PALETTE.length],
          cwd: join(SERIALPORT, 'packages', name),
          script: buildScript,
        })),
      ];
      // frontend 레인: tsc 타입체크와 vite 번들을 동시에 돌린다. 둘은 독립적이고
      // (tsc 는 noEmit — dist 미접근), 자원 프로파일이 상보적이라(tsc≈1코어 / vite≈전코어)
      // 경합 없이 겹친다. 타입체크는 그대로 게이트로 유지 — 둘 중 하나라도 실패하면 중단.
      const frontendTasks: BuildTask[] = [
        {
          label: 'frontend:tsc',
          color: C.magenta,
          cwd: FRONTEND,
          script: 'typecheck',
        },
        {
          label: 'frontend:vite',
          color: C.blue,
          cwd: FRONTEND,
          script: dev ? 'build:bundle:dev' : 'build:bundle',
        },
      ];

      banner('1/3a 경량(esbuild) 빌드 — backend + serialport 병렬');
      console.log(
        `  ${C.dim}· ${lightTasks.map((t) => t.label).join(', ')}${C.reset}`,
      );
      const light = await runBuildPhase(lightTasks);
      lightWallMs = light.wallMs;
      buildTimings.push(...light.timings);
      abortOnFailures(light.failures, target);
      console.log(`  ${C.dim}경량 그룹 벽시계: ${fmt(lightWallMs)}${C.reset}`);

      banner('1/3b frontend 단독 레인 (tsc ∥ vite 동시 — 머신 독점)');
      const front = await runBuildPhase(frontendTasks);
      frontendWallMs = front.wallMs;
      buildTimings.push(...front.timings);
      abortOnFailures(front.failures, target);
      banner('빌드 완료');
    }

    // 2/3 취합
    banner('2/3 dist 취합 → kiosk-electron/target');
    const collectStart = Date.now();
    collect(join(BACKEND, 'dist'), join(TARGET, 'backend'), 'backend', BACKEND);
    collect(
      join(FRONTEND, 'dist'),
      join(TARGET, 'frontend'),
      'frontend',
      FRONTEND,
    );
    // serialport 는 통째로 비우고 감지된 패키지만 다시 채운다(삭제된 패키지의 잔재 방지).
    rmSync(join(TARGET, 'serialport'), { recursive: true, force: true });
    for (const name of serialports) {
      collect(
        join(SERIALPORT, 'packages', name, 'dist'),
        join(TARGET, 'serialport', name),
        `serialport/${name}`,
        join(SERIALPORT, 'packages', name),
      );
    }
    const collectMs = Date.now() - collectStart;

    // 3/3 electron make|package
    banner(`3/3 electron ${electronScript}`);
    const electronStart = Date.now();
    await runElectron(electronScript);
    const electronMs = Date.now() - electronStart;

    printTimingSummary({
      buildTimings,
      lightWallMs,
      frontendWallMs,
      collectMs,
      electronMs,
      electronScript,
      totalMs: Date.now() - totalStart,
      skipBuild,
    });

    banner(`✨ 완료 — 산출물: ${rel(join(ELECTRON, outDir))}`);
  } catch (err) {
    console.error(
      `\n${C.red}❌ 빌드 파이프라인 실패:${C.reset}`,
      (err as Error)?.message ?? err,
    );
    process.exit(1);
  }
}
