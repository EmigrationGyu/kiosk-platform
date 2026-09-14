/**
 * 원격 부분 업데이트 하네스 — **서버 대역**.
 *
 * 키오스크 쪽(적용·검증·되감기)은 진짜 Phase 4 코드다. 여기서 가짜로 두는 것은 공급(S3
 * 대신 로컬 빌드)과 지시(서버 mutation 대신 파일 하나)뿐이라, 나중에 도착 경로만 바뀐다.
 *
 *   bun scripts/update-harness.ts bake <컴포넌트> <세대>   빌드해서 세대로 적재
 *   bun scripts/update-harness.ts apply <컴포넌트>=<세대>… 매니페스트를 놓는다
 *   bun scripts/update-harness.ts list                    세대·포인터 현황
 *   bun scripts/update-harness.ts break <컴포넌트> <세대>  산출물을 망가뜨린다(실패 시나리오)
 *   bun scripts/update-harness.ts drift <컴포넌트> <세대>  total 만 어긋냄(승격 통과가 정상)
 *   bun scripts/update-harness.ts drift-surface <컴포넌트> <세대>  자기 표면을 어긋냄(되감겨야 정상)
 *   bun scripts/update-harness.ts hang  <컴포넌트> <세대>  기동은 하되 멈추는 산출물
 *   bun scripts/update-harness.ts crash-after-ready <컴포넌트> <세대> [지연ms]
 *                                                          준비 선언 뒤에 죽는 산출물
 *   bun scripts/update-harness.ts blank <세대>             홈에 못 가는 프론트(흰 화면)
 *   bun scripts/update-harness.ts reset                   포인터를 지워 전부 baseline 으로
 *   bun scripts/update-harness.ts set-live <컴포넌트>=<세대>…  포인터만 직접 쓴다
 *   bun scripts/update-harness.ts leave-staging            rename 직전 잔여 파일을 만든다
 *   bun scripts/update-harness.ts rollback                 롤백 지시를 놓는다(목적지 없음)
 *   bun scripts/update-harness.ts stack                    되돌림 스택·마지막 적용 기록
 *   bun scripts/update-harness.ts apply-base <설치본 버전>  앱 전체 설치 지시를 놓는다
 *   bun scripts/update-harness.ts scenario rollback <컴포넌트> <세대1> <세대2>
 *                                                          앱을 띄운 채 돌리는 자동 시나리오 —
 *                                                          지시를 놓고 파일 상태를 **기다려** 검증
 *   KIOSK_ARTIFACT_ROOT=running bun scripts/update-harness.ts scenario base-rollback <컴포넌트> <세대> <설치본 버전>
 *                                                          설치본을 넘는 롤백 — 설치된 앱에서만
 *
 *   KIOSK_ARTIFACT_ROOT=running   떠 있는 앱의 루트를 쓴다(설치된 앱). 경로를 직접 줘도 된다.
 *
 * 공급을 **진짜처럼** 하려면 S3 대역이 필요하다. `publish` 는 CI 가 올릴 것과 같은 것을
 * 굽고(아카이브·서명·서술자), `serve` 는 그것을 HTTP 로 내준다. 그러면 다운로드·해시
 * 대조·서명 검증까지 제품 코드가 그대로 돈다.
 *
 *   bun scripts/update-harness.ts publish <컴포넌트> <세대> --key <개인키.pem>
 *   bun scripts/update-harness.ts serve [포트]
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { APPLY_RECORD_FILE } from '../kiosk-types/src/update/applyRecord';
import {
  artifactPrefix,
  componentSegments,
  LOCAL_DATA_DIR,
  LOCAL_UPDATE_DIR,
  type UpdateComponent,
} from '../kiosk-types/src/update/components';
import {
  BASELINE_GENERATION,
  GENERATIONS_DIR,
  generationSegments,
  LIVE_POINTER_FILE,
  STABLE_POINTER_FILE,
  UPDATABLE_COMPONENTS,
} from '../kiosk-types/src/update/generation';
import {
  ROLLBACK_INTENT_FILE,
  ROLLBACK_STACK_FILE,
} from '../kiosk-types/src/update/rollbackStack';
import { bakeArtifact, readSigningKey } from './ci/bake-artifact';

const ROOT = import.meta.dir
  ? path.resolve(import.meta.dir, '..')
  : process.cwd();
const OUT_ROOT = path.join(
  ROOT,
  'kiosk-electron',
  'out',
  'Kiosk-win32-x64',
  'resources',
  'target',
);

/** 떠 있는 키오스크의 exe — 없으면 null. */
function runningExe(): string | null {
  const out = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-Process Kiosk -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path',
    ],
    { encoding: 'utf-8' },
  ).stdout.trim();
  return out || null;
}

/**
 * Squirrel 디렉토리 이름 규칙 — 프리릴리즈의 점을 뗀다(`1.28.0-alpha.1` → `app-1.28.0-alpha1`).
 * 비교는 양쪽을 이 모양으로 맞춰서 한다.
 */
const squirrelName = (version: string): string =>
  version.replace(/-(.*)$/, (_, pre: string) => `-${pre.replace(/\./g, '')}`);

/** 떠 있는 앱의 설치본 버전(Squirrel 표기) — 경로의 `app-{버전}`. 패키징 out/ 이면 null. */
const runningBase = (): string | null =>
  runningExe()?.match(/[\\/]app-([^\\/]+)[\\/]/)?.[1] ?? null;

const isRunning = (version: string): boolean =>
  runningBase() === squirrelName(version);

/**
 * 아티팩트 루트 — 기본은 패키징 결과물(out/).
 *
 * `KIOSK_ARTIFACT_ROOT=running` 이면 **지금 떠 있는 앱**의 것을 매번 다시 찾는다 — 설치본을
 * 넘는 시나리오에서는 앱이 갈리면 루트도 갈린다. 경로를 직접 주면 그것을 쓴다.
 */
function artifactRoot(): string {
  const override = process.env.KIOSK_ARTIFACT_ROOT;
  if (!override) return OUT_ROOT;
  if (override !== 'running') return override;
  const exe = runningExe();
  if (!exe) throw new Error('떠 있는 Kiosk 이 없습니다');
  return path.join(path.dirname(exe), 'resources', 'target');
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

/** 컴포넌트의 소스 디렉토리와 빌드 산출물 위치. */
function sourceOf(component: UpdateComponent): { cwd: string; dist: string } {
  if (component === 'backend') {
    const cwd = path.join(ROOT, 'kiosk-backend');
    return { cwd, dist: path.join(cwd, 'dist') };
  }
  if (component === 'frontend') {
    const cwd = path.join(ROOT, 'kiosk-frontend');
    return { cwd, dist: path.join(cwd, 'dist') };
  }
  const cwd = path.join(ROOT, 'kiosk-serialport', 'packages', component);
  return { cwd, dist: path.join(cwd, 'dist') };
}

const generationDir = (component: UpdateComponent, generation: string) =>
  path.join(artifactRoot(), ...generationSegments(component, generation));

function run(cwd: string, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['run', script], {
      cwd,
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} 실패 (${code})`)),
    );
  });
}

function assertComponent(name: string): UpdateComponent {
  const match = UPDATABLE_COMPONENTS.find((c) => c === name);
  if (!match) {
    console.error(
      `알 수 없는 컴포넌트: ${name}\n  가능: ${UPDATABLE_COMPONENTS.join(', ')}`,
    );
    process.exit(1);
  }
  return match;
}

async function bake(name: string, generation: string): Promise<void> {
  const component = assertComponent(name);
  const { cwd, dist } = sourceOf(component);

  console.log(`${C.cyan}==>${C.reset} ${component} 빌드`);
  await run(cwd, component === 'frontend' ? 'build:bundle' : 'build:prod');

  const dest = generationDir(component, generation);
  mkdirSync(dest, { recursive: true });
  // 세대는 CI 가 올리는 것(dist/)과 정확히 같은 것만 담는다.
  for (const entry of readdirSync(dist)) {
    cpSync(path.join(dist, entry), path.join(dest, entry), { recursive: true });
  }
  console.log(
    `${C.green}✓${C.reset} 적재: ${component}@${generation} ${C.dim}${dest}${C.reset}`,
  );
}

function apply(specs: string[]): void {
  const components: Record<string, string> = {};
  for (const spec of specs) {
    const [name, generation] = spec.split('=');
    if (!name || !generation) {
      console.error(`형식: <컴포넌트>=<세대>  (받은 값: ${spec})`);
      process.exit(1);
    }
    components[assertComponent(name)] = generation;
  }

  const file = path.join(artifactRoot(), 'pending-manifest.json');
  writeFileSync(
    file,
    `${JSON.stringify({ manifestVersion: 1, components }, null, 2)}\n`,
  );
  console.log(
    `${C.green}✓${C.reset} 매니페스트 배치 ${C.dim}${file}${C.reset}`,
  );
  for (const [name, generation] of Object.entries(components)) {
    console.log(`    ${name} → ${generation}`);
  }
}

/** 앱 전체 설치 지시 — 설치본은 키오스크가 서술자를 보고 받는다(S3 또는 serve). */
function applyBase(version: string): void {
  writeFileSync(
    pendingFile(),
    `${JSON.stringify({ manifestVersion: 1, components: {}, base: version })}\n`,
  );
  console.log(
    `${C.green}✓${C.reset} 설치본 지시 배치 base=${version} ${C.dim}${pendingFile()}${C.reset}`,
  );
}

/**
 * 적용을 거치지 않고 포인터만 쓴다 — **"포인터를 쓴 직후 강제 종료된" 상태**를 재현한다.
 *
 * 적용 도중 강제 종료를 손으로 맞히려면 1초짜리 창을 노려야 하는데, 정작 확인할 것은
 * 타이밍이 아니라 **끊긴 뒤에도 유효한 상태로 뜨는가**다. 그 상태를 직접 만들면 결정적으로
 * 재현된다.
 */
function setLive(specs: string[]): void {
  const components: Record<string, string> = {};
  for (const spec of specs) {
    const [name, generation] = spec.split('=');
    if (!name || !generation) {
      console.error(`형식: <컴포넌트>=<세대>  (받은 값: ${spec})`);
      process.exit(1);
    }
    components[assertComponent(name)] = generation;
  }
  writeFileSync(
    path.join(artifactRoot(), LIVE_POINTER_FILE),
    `${JSON.stringify({ pointerVersion: 1, components }, null, 2)}
`,
  );
  console.log(`${C.yellow}!${C.reset} 포인터 직접 씀 (적용 절차 생략)`);
  for (const [name, generation] of Object.entries(components)) {
    console.log(`    ${name} → ${generation}`);
  }
}

/** rename 직전에 끊긴 상태 — staging 잔여물이 남아도 무해해야 한다. */
function leaveStaging(): void {
  const at = path.join(artifactRoot(), `${LIVE_POINTER_FILE}.staging`);
  writeFileSync(at, '{ 반쯤 쓰이다 끊긴 파일');
  console.log(`${C.yellow}!${C.reset} staging 잔여물 생성: ${at}`);
}

function readPointer(fileName: string): Record<string, string> {
  const file = path.join(artifactRoot(), fileName);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')).components ?? {};
  } catch {
    return {};
  }
}

function list(): void {
  const live = readPointer(LIVE_POINTER_FILE);
  const stable = readPointer(STABLE_POINTER_FILE);

  console.log(
    `${C.cyan}==>${C.reset} 세대 현황  ${C.dim}${artifactRoot()}${C.reset}\n`,
  );
  for (const component of UPDATABLE_COMPONENTS) {
    const dir = path.join(
      artifactRoot(),
      ...componentSegments(component),
      GENERATIONS_DIR,
    );
    if (!existsSync(dir)) continue;

    const marks = readdirSync(dir).map((generation) => {
      const flags = [
        live[component] === generation ||
        (!live[component] && generation === 'baseline')
          ? `${C.green}live${C.reset}`
          : '',
        stable[component] === generation ? `${C.yellow}stable${C.reset}` : '',
      ].filter(Boolean);
      return flags.length > 0
        ? `${generation}(${flags.join(',')})`
        : `${C.dim}${generation}${C.reset}`;
    });
    console.log(`  ${component.padEnd(18)} ${marks.join('  ')}`);
  }
}

/** 세대 디렉토리 안에서 지문 문자열 하나를 치환한다 — drift 계열의 공통 뼈대. */
function replaceHash(
  component: UpdateComponent,
  generation: string,
  real: string,
): number {
  const dir = generationDir(component, generation);
  if (!existsSync(dir)) {
    console.error(`없는 세대: ${component}@${generation}`);
    process.exit(1);
  }
  const drifted = `dead${real.slice(4)}`;

  let touched = 0;
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const body = readFileSync(full, 'utf8');
      if (!body.includes(real)) continue;
      writeFileSync(full, body.split(real).join(drifted));
      touched += 1;
    }
  };
  walk(dir);

  if (touched === 0) {
    console.error(
      `지문을 찾지 못했습니다: ${component}@${generation} (${real.slice(0, 12)})`,
    );
    process.exit(1);
  }
  return touched;
}

const readContract = () =>
  JSON.parse(
    readFileSync(path.join(ROOT, 'kiosk-types', 'contract.json'), 'utf8'),
  ) as {
    total: string;
    frontendBackend: string;
    processes: Record<string, string>;
  };

/**
 * **total 만** 어긋나게 한다 — "무관한 계약 변경과 함께 빌드된 산출물"을 흉내낸다.
 *
 * 판정이 표면 단위가 된 뒤로 이것은 실패 시나리오가 아니다: 자기 표면은 그대로이므로
 * **승격이 통과해야 정상**이다(총합 대조 시절엔 되감겼다 — 그 뒤집힘을 검증하는 도구).
 *
 * types 를 실제로 바꿔 빌드하는 대신 산출물 안의 지문 문자열을 갈아끼운다. 감지는 컴포넌트가
 * **보고하는 지문**으로 이뤄지므로 결과가 같고, 제품 코드에 테스트 훅이 들어가지 않는다.
 */
function driftContract(name: string, generation: string): void {
  const component = assertComponent(name);
  const touched = replaceHash(component, generation, readContract().total);
  console.log(
    `${C.yellow}!${C.reset} total 어긋냄(표면은 그대로): ${component}@${generation} (${touched}개 파일) — 승격이 통과해야 정상`,
  );
}

/**
 * **자기 표면**을 어긋나게 한다 — "이 관계의 스키마가 다른 types 로 빌드된 산출물".
 *
 * 이쪽이 진짜 실패 시나리오다: 말이 오가는 표면이 갈렸으므로 되감겨야 한다.
 * frontend 는 프론트↔백엔드 합성, 장치는 자기 프로세스 표면을 치환한다.
 */
function driftSurface(name: string, generation: string): void {
  const component = assertComponent(name);
  const contract = readContract();
  const real =
    component === 'frontend'
      ? contract.frontendBackend
      : contract.processes[component];
  if (!real) {
    console.error(
      `표면이 없는 컴포넌트입니다: ${component} (backend 는 상대 쪽을 어긋내세요)`,
    );
    process.exit(1);
  }
  const touched = replaceHash(component, generation, real);
  console.log(
    `${C.yellow}!${C.reset} 표면 어긋냄: ${component}@${generation} (${touched}개 파일) — 되감겨야 정상`,
  );
}

/**
 * 준비 선언(포트 구독)까지는 정상으로 가고 **그 뒤에** 죽는 산출물 — 크래시 카운터 경로.
 *
 * 워치독·적용 사다리가 못 보는 모양이다: 매 세대가 선언까지 가서 워치독이 매번 해제되고,
 * 적용 시점의 awaitReady 도 선언에서 resolve 해 "성공"으로 끝난다. 이 반복을 세는 것은
 * 크래시 에스컬레이터뿐이다.
 */
function crashAfterReady(
  name: string,
  generation: string,
  delayMs: string | undefined,
): void {
  const component = assertComponent(name);
  const file = path.join(generationDir(component, generation), 'index.js');
  if (!existsSync(file)) {
    console.error(`없는 세대: ${component}@${generation}`);
    process.exit(1);
  }
  const delay = Number(delayMs ?? 3000);
  writeFileSync(
    file,
    `${readFileSync(file, 'utf-8')}
setTimeout(() => process.exit(1), ${delay});
`,
  );
  console.log(
    `${C.yellow}!${C.reset} 선언 후 크래시: ${component}@${generation} (+${delay}ms)`,
  );
}

/**
 * 홈에 도달하지 못하는 프론트 — 렌더러 준비 워치독 경로.
 *
 * index.html 은 그대로 두고 JS 만 자른다: dom-ready 가 발화해 포트 배선까지 정상으로
 * 보이지만 앱 코드가 던져 흰 화면이 된다. 프로세스 이벤트가 하나도 없는, 선언의 부재만이
 * 유일한 증거인 실패 모양이다.
 */
function blankFrontend(generation: string): void {
  const dir = generationDir('frontend', generation);
  const indexHtml = path.join(dir, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error(`없는 세대(index.html 없음): frontend@${generation}`);
    process.exit(1);
  }
  // 아무 .js 나 자르면 지연 청크일 수 있어 흰 화면이 안 난다 — index.html 이 로드하는
  // **엔트리**를 자른다.
  const entry = readFileSync(indexHtml, 'utf-8').match(
    /src="\.?\/?(assets\/[^"]+\.js)"/,
  )?.[1];
  if (!entry) {
    console.error(`엔트리 스크립트를 찾지 못했습니다: frontend@${generation}`);
    process.exit(1);
  }
  const file = path.join(dir, entry);
  writeFileSync(file, readFileSync(file, 'utf-8').slice(0, 200));
  console.log(
    `${C.yellow}!${C.reset} 흰 화면으로 만듦: frontend@${generation} (${entry})`,
  );
}

/** 죽지 않고 **멈추는** 산출물 — 준비 선언이 영영 오지 않는 경우(워치독 경로). */
function hangArtifact(name: string, generation: string): void {
  const component = assertComponent(name);
  const file = path.join(generationDir(component, generation), 'index.js');
  if (!existsSync(file)) {
    console.error(`없는 세대: ${component}@${generation}`);
    process.exit(1);
  }
  writeFileSync(file, 'while (true) {}');
  console.log(`${C.yellow}!${C.reset} 멈추게 함: ${component}@${generation}`);
}

/** 포인터를 지운다 — 세대는 남기고 전부 baseline 으로 되돌린다(시나리오 반복용). */
function reset(): void {
  let removed = 0;
  for (const file of [LIVE_POINTER_FILE, STABLE_POINTER_FILE]) {
    const at = path.join(artifactRoot(), file);
    if (!existsSync(at)) continue;
    rmSync(at);
    removed += 1;
  }
  // 소비된 매니페스트 표식도 치운다 — 안 그러면 같은 이름으로 다시 못 놓는다.
  const consumed = path.join(artifactRoot(), 'pending-manifest.json.consumed');
  if (existsSync(consumed)) rmSync(consumed);
  // 되돌림 스택은 홈 디렉토리에 산다 — 시나리오를 반복하려면 같이 비운다.
  for (const file of [ROLLBACK_STACK_FILE, ROLLBACK_INTENT_FILE]) {
    const at = path.join(UPDATE_DIR, file);
    if (!existsSync(at)) continue;
    rmSync(at);
    removed += 1;
  }
  console.log(
    `${C.green}✓${C.reset} 포인터·스택 초기화 (${removed}개 파일 제거)`,
  );
}

/** 홈 디렉토리의 업데이트 자리 — 설치본이 갈려도 남는 곳(키오스크와 같은 규칙). */
const UPDATE_DIR = path.join(homedir(), LOCAL_DATA_DIR, LOCAL_UPDATE_DIR);
const pendingFile = () => path.join(artifactRoot(), 'pending-manifest.json');

/** 롤백 지시 — 목적지 없이. 서버 경로가 보내는 것과 같은 모양이다. */
function rollback(): void {
  writeFileSync(pendingFile(), `${JSON.stringify({ rollback: true })}\n`);
  console.log(
    `${C.green}✓${C.reset} 롤백 지시 배치 ${C.dim}${pendingFile()}${C.reset}`,
  );
}

type StackFile = {
  entries: {
    base: string;
    components: Record<string, string>;
    commandId: string | null;
    at: string;
  }[];
};

function readStack(): StackFile {
  const file = path.join(UPDATE_DIR, ROLLBACK_STACK_FILE);
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as StackFile;
  } catch {
    return { entries: [] };
  }
}

function readApplyRecord(): Record<string, unknown> | null {
  const file = path.join(UPDATE_DIR, APPLY_RECORD_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stack(): void {
  const { entries } = readStack();
  console.log(
    `${C.cyan}==>${C.reset} 되돌림 스택  ${C.dim}${UPDATE_DIR}${C.reset}\n`,
  );
  if (entries.length === 0) console.log('  (비어 있음)');
  entries.forEach((entry, at) => {
    const top = at === entries.length - 1 ? ` ${C.yellow}← top${C.reset}` : '';
    const components =
      Object.entries(entry.components)
        .map(([c, g]) => `${c}=${g}`)
        .join(' ') || '(전부 baseline)';
    console.log(
      `  ${String(at).padStart(2)}  base=${entry.base}  ${components}  ${C.dim}${entry.commandId ?? 'harness'} ${entry.at}${C.reset}${top}`,
    );
  });

  const record = readApplyRecord();
  console.log(`\n${C.cyan}==>${C.reset} 마지막 적용 기록`);
  console.log(
    record
      ? `  ${record.outcome}  ${C.dim}${record.detail}  (${record.at})${C.reset}`
      : '  (없음)',
  );
}

// ── 자동 시나리오 ────────────────────────────────────────────────────────────
//
// 지시는 파일로 놓이고 결과는 **나중에** 파일로 드러난다 — 그 사이가 곧 검증할 것이다.
// 매 단계는 "놓는다 → 기대 상태가 될 때까지 기다린다" 이고, 시간 안에 안 되면 실패다.
// 손으로 돌리면 놓치는 것(빠른 연속 지시·pop 누락)을 결정적으로 잡기 위해서다.

const STEP_TIMEOUT_MS = 120_000;
/** 장치 세대 교체는 0.5초 안에 끝난다 — 중간 상태를 보려면 그보다 촘촘해야 한다. */
const POLL_MS = 50;

type Step = {
  label: string;
  act?: () => void | Promise<void>;
  /** 폴링마다 불린다 — 중간 상태를 관측해 닫힌 변수에 남길 수 있다. */
  until: () => boolean;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 지시 파일이 집혀 갔는가 — 트리거가 읽기 전에 rename 하므로 부재가 곧 "소비 시작"이다. */
async function untilConsumed(): Promise<void> {
  const started = Date.now();
  while (existsSync(pendingFile())) {
    if (Date.now() - started > STEP_TIMEOUT_MS) {
      throw new Error('지시 파일이 소비되지 않았습니다 — 앱이 떠 있나요?');
    }
    await sleep(POLL_MS);
  }
}

async function waitFor(step: Step, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
  const started = Date.now();
  await step.act?.();
  while (!step.until()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`시간 초과: ${step.label}`);
    }
    await sleep(POLL_MS);
  }
  console.log(
    `${C.green}✓${C.reset} ${step.label} ${C.dim}(${((Date.now() - started) / 1000).toFixed(1)}s)${C.reset}`,
  );
}

const liveOf = (component: UpdateComponent): string =>
  readPointer(LIVE_POINTER_FILE)[component] ?? BASELINE_GENERATION;
const depth = (): number => readStack().entries.length;
const lastOutcome = (): string | undefined =>
  readApplyRecord()?.outcome as string | undefined;

/**
 * 롤백 왕복 — apply 두 번, rollback 세 번(마지막은 빈 스택 거절), 그리고 연속 지시.
 *
 * 앱이 떠 있어야 하고 두 세대가 미리 구워져 있어야 한다(`bake`). 백엔드 세대를 쓰면
 * 매 단계가 재기동을 동반해 느리므로 장치 컴포넌트를 권한다.
 */
async function scenarioRollback(
  name: string,
  g1: string,
  g2: string,
): Promise<void> {
  const component = assertComponent(name);
  for (const g of [g1, g2]) {
    if (!existsSync(generationDir(component, g))) {
      console.error(`없는 세대: ${component}@${g} — 먼저 bake 하세요`);
      process.exit(1);
    }
  }
  const base = depth();
  const at = (n: number) => base + n;
  console.log(
    `${C.cyan}==>${C.reset} 시나리오: ${component} ${liveOf(component)} → ${g1} → ${g2} → 롤백×3  ${C.dim}스택 깊이 ${base} 에서 시작${C.reset}\n`,
  );

  let sawApplied = false;
  const steps: Step[] = [
    {
      label: `apply ${g1} → live=${g1}, 스택 +1`,
      act: () => apply([`${component}=${g1}`]),
      until: () => liveOf(component) === g1 && depth() === at(1),
    },
    {
      label: `apply ${g2} → live=${g2}, 스택 +2`,
      act: () => apply([`${component}=${g2}`]),
      until: () => liveOf(component) === g2 && depth() === at(2),
    },
    {
      label: `rollback → live=${g1}, 스택 +1 (pop)`,
      act: rollback,
      until: () => liveOf(component) === g1 && depth() === at(1),
    },
    {
      label: 'rollback → live=baseline, 스택 원위치',
      act: rollback,
      until: () =>
        liveOf(component) === BASELINE_GENERATION && depth() === at(0),
    },
    {
      label: '빈 스택 rollback → declined 기록',
      act: () => {
        // 직전 기록과 구별하려면 outcome 이 바뀌는 것을 봐야 한다.
        if (lastOutcome() === 'declined') {
          rmSync(path.join(UPDATE_DIR, APPLY_RECORD_FILE), { force: true });
        }
        rollback();
      },
      until: () => lastOutcome() === 'declined' && depth() === at(0),
    },
    {
      // 앞 지시가 **도는 사이** 다음 지시가 놓인다 — 줄을 서야지 겹치면 안 된다.
      // apply 가 집혀 간 직후(아직 적용 전)에 롤백을 놓고, 두 상태를 순서대로 지나는지 본다.
      // 끝 상태만 보면 apply 가 덮어써져 사라진 경우와 구별되지 않는다.
      label: `연속 지시 apply ${g2} → (소비 직후) rollback → ${g2} 를 거쳐 baseline, 스택 원위치`,
      act: async () => {
        apply([`${component}=${g2}`]);
        await untilConsumed();
        rollback();
      },
      until: () => {
        if (liveOf(component) === g2 && depth() === at(1)) sawApplied = true;
        return (
          sawApplied &&
          liveOf(component) === BASELINE_GENERATION &&
          depth() === at(0)
        );
      },
    },
  ];

  for (const step of steps) await waitFor(step);
  console.log(`\n${C.green}✓ 시나리오 통과${C.reset}`);
}

function breakArtifact(name: string, generation: string): void {
  const component = assertComponent(name);
  const file = path.join(generationDir(component, generation), 'index.js');
  if (!existsSync(file)) {
    console.error(`없는 세대: ${component}@${generation}`);
    process.exit(1);
  }
  // 손상된 다운로드를 흉내낸다 — 제품 코드에 테스트 훅을 넣지 않는다.
  writeFileSync(file, readFileSync(file, 'utf-8').slice(0, 200));
  console.log(`${C.yellow}!${C.reset} 손상시킴: ${component}@${generation}`);
}

/** S3 대역의 로컬 루트 — `{prefix}/{version}/…` 레이아웃을 그대로 흉내낸다. */
const SERVE_ROOT = path.join(ROOT, '.artifact-store');
const DEFAULT_PORT = 8787;

/**
 * CI 가 올릴 것과 **같은 것**을 굽는다 — 아카이브·서명·서술자.
 *
 * 서명은 개인키가 있어야 하므로 경로를 받는다. 제품 코드에 개발용 우회로를 만들지
 * 않는다는 뜻이다 — 검증 경로는 실기기와 완전히 같은 것이 돈다.
 */
async function publish(
  name: string,
  version: string,
  keyPath: string,
  baseUrl: string,
): Promise<void> {
  const component = assertComponent(name);
  const { cwd, dist } = sourceOf(component);

  console.log(`${C.cyan}==>${C.reset} ${component} 빌드`);
  await run(cwd, component === 'frontend' ? 'build:bundle' : 'build:prod');

  const prefix = artifactPrefix(component);
  const outDir = path.join(SERVE_ROOT, prefix, version);
  // 굽는 것은 CI 와 **같은 코드**다 — 두 벌이면 검증한 모양과 올리는 모양이 갈린다.
  const { archiveBytes, sha256 } = bakeArtifact({
    distDir: dist,
    outDir,
    prefix,
    component,
    version,
    baseUrl,
    privateKeyPem: readSigningKey(keyPath),
  });

  console.log(
    `${C.green}✓${C.reset} 게시: ${prefix}@${version} ` +
      `${C.dim}${archiveBytes} bytes sha=${sha256.slice(0, 12)}${C.reset}`,
  );
  console.log(`${C.dim}    ${outDir}${C.reset}`);
}

/** 게시한 것을 HTTP 로 내준다 — 키오스크의 ARTIFACT_BASE_URL 이 여기를 가리킨다. */
function serve(port: number): void {
  if (!existsSync(SERVE_ROOT)) {
    console.error(`게시된 것이 없습니다: ${SERVE_ROOT}`);
    process.exit(1);
  }
  Bun.serve({
    port,
    fetch(request) {
      const file = path.join(SERVE_ROOT, new URL(request.url).pathname);
      // 저장소 밖으로 새지 않게 — 하네스라도 경로 조작은 막는다.
      if (!file.startsWith(SERVE_ROOT) || !existsSync(file)) {
        console.log(
          `${C.yellow}404${C.reset} ${new URL(request.url).pathname}`,
        );
        return new Response('not found', { status: 404 });
      }
      console.log(`${C.green}200${C.reset} ${new URL(request.url).pathname}`);
      return new Response(Bun.file(file));
    },
  });
  console.log(
    `${C.cyan}==>${C.reset} S3 대역 http://127.0.0.1:${port} ${C.dim}${SERVE_ROOT}${C.reset}`,
  );
  console.log(
    `${C.dim}    패키징할 때: ARTIFACT_BASE_URL=http://127.0.0.1:${port} bun run package${C.reset}`,
  );
}

/** 폴링 중 앱이 갈리는 순간에는 루트를 못 찾는다 — 그 틱은 "아직"으로 읽는다. */
const safely = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

/**
 * 설치본을 넘는 롤백 — A 에서 컴포넌트를 올리고, B 로 전체 설치한 뒤, 롤백 한 번으로
 * A + 그 컴포넌트까지 돌아오는가. 두 설치본 모두 이 코드가 들어 있어야 한다(B 가 intent 를
 * 쓰고, 다시 뜬 A 가 이어서 놓는다).
 *
 * `KIOSK_ARTIFACT_ROOT=running` 으로 돌려야 한다 — 앱이 갈리면 루트도 갈린다.
 */
async function scenarioBaseRollback(
  name: string,
  generation: string,
  targetBase: string,
): Promise<void> {
  const component = assertComponent(name);
  const startBase = runningBase();
  if (!startBase) {
    console.error(
      '설치된 앱이 떠 있어야 합니다(app-{버전} 경로). out/ 패키지는 안 됩니다.',
    );
    process.exit(1);
  }
  if (startBase === squirrelName(targetBase)) {
    console.error(
      `이미 ${targetBase} 입니다 — 다른 설치본으로 넘어가야 시나리오가 됩니다`,
    );
    process.exit(1);
  }
  const base = depth();
  const at = (n: number) => base + n;
  const live = () => safely(() => liveOf(component), null);
  console.log(
    `${C.cyan}==>${C.reset} 시나리오: ${startBase} + ${component}@${generation} → ${targetBase} → 롤백  ${C.dim}스택 깊이 ${base}${C.reset}
`,
  );

  const steps: Step[] = [
    {
      label: `apply ${component}=${generation} → live=${generation}, 스택 +1`,
      act: () => apply([`${component}=${generation}`]),
      until: () => live() === generation && depth() === at(1),
    },
    {
      // 넘기기 전에 push 되므로 스택이 먼저 +2 가 되고, 그 뒤 앱이 갈린다.
      label: `apply base ${targetBase} → 앱이 ${targetBase} 로 다시 뜸, 스택 +2, 기록 applied`,
      act: () => applyBase(targetBase),
      until: () =>
        isRunning(targetBase) &&
        depth() === at(2) &&
        lastOutcome() === 'applied' &&
        readApplyRecord()?.requestedBase === targetBase,
    },
    {
      // B 의 target 은 새것이라 컴포넌트는 baseline — 그래야 롤백이 둘 다 되돌리는 게 보인다.
      label: `${targetBase} 에서 ${component} 는 baseline`,
      until: () => live() === BASELINE_GENERATION,
    },
    {
      // 롤백 한 번 = pop 한 번. 설치본 항목만 빠지고 컴포넌트 항목(+1)은 남는다 — 한 번 더
      // 누르면 그것도 되돌아간다.
      label: `rollback → ${startBase} 로 다시 뜨고 ${component}=${generation} 복원, 스택 +1, intent 소진`,
      act: rollback,
      until: () =>
        runningBase() === startBase &&
        live() === generation &&
        depth() === at(1) &&
        !existsSync(path.join(UPDATE_DIR, ROLLBACK_INTENT_FILE)),
    },
  ];

  for (const step of steps) await waitFor(step, 10 * 60_000);
  console.log(`
${C.green}✓ 시나리오 통과${C.reset}`);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'bake':
    await bake(rest[0], rest[1]);
    break;
  case 'apply':
    apply(rest);
    break;
  case 'list':
    list();
    break;
  case 'break':
    breakArtifact(rest[0], rest[1]);
    break;
  case 'drift':
    driftContract(rest[0], rest[1]);
    break;
  case 'drift-surface':
    driftSurface(rest[0], rest[1]);
    break;
  case 'hang':
    hangArtifact(rest[0], rest[1]);
    break;
  case 'crash-after-ready':
    crashAfterReady(rest[0], rest[1], rest[2]);
    break;
  case 'blank':
    blankFrontend(rest[0]);
    break;
  case 'reset':
    reset();
    break;
  case 'set-live':
    setLive(rest);
    break;
  case 'leave-staging':
    leaveStaging();
    break;
  case 'rollback':
    rollback();
    break;
  case 'stack':
    stack();
    break;
  case 'apply-base':
    if (!rest[0]) {
      console.error('형식: apply-base <설치본 버전>');
      process.exit(1);
    }
    applyBase(rest[0]);
    break;
  case 'scenario':
    if (rest[0] === 'rollback' && rest[1] && rest[2] && rest[3]) {
      await scenarioRollback(rest[1], rest[2], rest[3]);
      break;
    }
    if (rest[0] === 'base-rollback' && rest[1] && rest[2] && rest[3]) {
      await scenarioBaseRollback(rest[1], rest[2], rest[3]);
      break;
    }
    console.error(
      [
        '형식: scenario rollback <컴포넌트> <세대1> <세대2>',
        '      scenario base-rollback <컴포넌트> <세대> <설치본 버전>  (KIOSK_ARTIFACT_ROOT=running)',
      ].join('\n'),
    );
    process.exit(1);
  case 'publish': {
    const keyIndex = rest.indexOf('--key');
    if (keyIndex === -1 || !rest[keyIndex + 1]) {
      console.error('개인키가 필요합니다: --key <경로>');
      process.exit(1);
    }
    const portIndex = rest.indexOf('--port');
    const port = portIndex === -1 ? DEFAULT_PORT : Number(rest[portIndex + 1]);
    await publish(
      rest[0],
      rest[1],
      rest[keyIndex + 1],
      `http://127.0.0.1:${port}`,
    );
    break;
  }
  case 'serve':
    serve(rest[0] ? Number(rest[0]) : DEFAULT_PORT);
    break;
  default:
    console.log(
      [
        '사용법:',
        '  bun scripts/update-harness.ts bake <컴포넌트> <세대>',
        '  bun scripts/update-harness.ts apply <컴포넌트>=<세대>...',
        '  bun scripts/update-harness.ts list',
        '  bun scripts/update-harness.ts break <컴포넌트> <세대>',
        '  bun scripts/update-harness.ts drift <컴포넌트> <세대>',
        '  bun scripts/update-harness.ts drift-surface <컴포넌트> <세대>',
        '  bun scripts/update-harness.ts hang  <컴포넌트> <세대>',
        '  bun scripts/update-harness.ts crash-after-ready <컴포넌트> <세대> [지연ms]',
        '  bun scripts/update-harness.ts blank <세대>',
        '  bun scripts/update-harness.ts reset',
        '  bun scripts/update-harness.ts set-live <컴포넌트>=<세대>...',
        '  bun scripts/update-harness.ts leave-staging',
        '  bun scripts/update-harness.ts rollback',
        '  bun scripts/update-harness.ts stack',
        '  bun scripts/update-harness.ts apply-base <설치본 버전>',
        '  bun scripts/update-harness.ts scenario rollback <컴포넌트> <세대1> <세대2>',
        '  KIOSK_ARTIFACT_ROOT=running bun scripts/update-harness.ts scenario base-rollback <컴포넌트> <세대> <설치본 버전>',
        '  bun scripts/update-harness.ts publish <컴포넌트> <세대> --key <개인키.pem> [--port N]',
        '  bun scripts/update-harness.ts serve [포트]',
      ].join('\n'),
    );
    process.exit(1);
}
