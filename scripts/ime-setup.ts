/**
 * IME 자산 로컬 설치 — 받아둔 엔진을 `~/.kiosk/` 아래 제자리에 놓는다.
 *
 * 단말에서는 백엔드가 CDN 에서 "없으면 받기"로 채운다(`ImeAssetService`). 이 저장소에는
 * 그 CDN 이 없으므로(엔진 바이너리는 재배포 조건이 달라 동봉하지 않는다) 직접 받아온 것을
 * 놓아야 하고, 그 수작업을 대신하는 것이 이 스크립트다.
 *
 * 무엇을 어디에 놓는지는 `IME_ASSET_BUNDLES` 가 단일 진실이다 — 번들이 늘어도 여기는
 * 고치지 않는다.
 *
 *   bun scripts/ime-setup.ts --rime <디렉터리|tar.gz> --mozc <디렉터리|tar.gz>
 *   bun scripts/ime-setup.ts --from dist-ime        # ime-bundle.ts 산출물 디렉터리에서 둘 다
 *   bun scripts/ime-setup.ts --status               # 지금 무엇이 깔려 있는지만 본다
 *   bun scripts/ime-setup.ts ... --force            # 이미 있어도 덮어쓴다
 *
 * **목적지엔 완전체 아니면 부재** — 런타임 프로비저너와 같은 불변식이다. 임시 디렉터리에
 * 풀어 핵심 파일(`keyFile`)을 확인한 뒤에야 제자리로 옮긴다. 중간에 실패하면 목적지는
 * 손대지 않은 채로 남으므로, 반쯤 깔린 엔진을 붙잡고 원인을 찾는 일이 없다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 루트 워크스페이스는 install 없이 쓰는 셸이라 패키지명 대신 상대 경로로 참조한다
// (ime-bundle.ts 와 같은 규약).
import {
  ASSET_MARKER_FILE,
  IME_ASSET_BUNDLES,
  type ImeAssetBundle,
} from '../kiosk-types/src/types/ime';
import { LOCAL_DATA_DIR } from '../kiosk-types/src/update/components';
import { tarBinary } from './lib/host-platform';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const HOME = path.join(os.homedir(), LOCAL_DATA_DIR);
const TAR = tarBinary();

const argv = Bun.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const FORCE = argv.includes('--force');
const STATUS_ONLY = argv.includes('--status');
const FROM = flag('from');

/** 번들 → 사용자가 준 소스. `--from` 은 그 디렉터리에서 규약된 archive 이름을 찾는다. */
const sourceOf = (bundle: ImeAssetBundle, key: string): string | undefined => {
  const explicit = flag(key);
  if (explicit) return path.resolve(explicit);
  if (!FROM) return undefined;
  const candidate = path.resolve(FROM, bundle.archive);
  return fs.existsSync(candidate) ? candidate : undefined;
};

const targetOf = (bundle: ImeAssetBundle): string =>
  path.join(HOME, bundle.dirName);

/** 설치된 것으로 치는 기준 — 런타임과 같게 디렉터리 유무만 본다. */
const installed = (bundle: ImeAssetBundle): boolean =>
  fs.existsSync(targetOf(bundle));

function report(bundle: ImeAssetBundle, label: string): void {
  const dir = targetOf(bundle);
  if (!installed(bundle)) {
    console.log(
      `  ${C.dim}○${C.reset} ${label.padEnd(5)} ${C.dim}없음 — ${dir}${C.reset}`,
    );
    return;
  }
  const keyOk = fs.existsSync(path.join(dir, bundle.keyFile));
  const mark = keyOk ? `${C.green}●${C.reset}` : `${C.red}●${C.reset}`;
  const note = keyOk
    ? ''
    : ` ${C.red}(${bundle.keyFile} 없음 — 불완전)${C.reset}`;
  console.log(`  ${mark} ${label.padEnd(5)} ${dir}${note}`);
}

/**
 * 소스를 staging 에 펼친다. tar.gz 면 풀고, 디렉터리면 복사한다.
 * staging 은 목적지와 같은 볼륨에 둔다 — 그래야 마지막 rename 이 원자적이다.
 */
function stage(
  source: string,
  stagingDir: string,
  bundle: ImeAssetBundle,
): void {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    // user/ 는 엔진이 만드는 런타임 산물이라 옮기지 않는다 — 다른 기계의 학습 이력이
    // 따라오면 변환 결과가 달라져 재현이 안 된다.
    fs.cpSync(source, stagingDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== 'user',
    });
  } else {
    const res = Bun.spawnSync([TAR, '-xzf', source, '-C', stagingDir]);
    if (res.exitCode !== 0) {
      throw new Error(
        `해제 실패 (${source}): ${new TextDecoder().decode(res.stderr).trim()}`,
      );
    }
  }

  // 한 겹 더 감싸 있으면(`rime/rime.dll` 처럼) 그 안으로 내려간다.
  if (!fs.existsSync(path.join(stagingDir, bundle.keyFile))) {
    const entries = fs.readdirSync(stagingDir);
    const only =
      entries.length === 1 ? path.join(stagingDir, entries[0] as string) : null;
    if (only && fs.statSync(only).isDirectory()) {
      const inner = path.join(stagingDir, '__inner');
      fs.renameSync(only, inner);
      for (const name of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, name), path.join(stagingDir, name));
      }
      fs.rmdirSync(inner);
    }
  }

  if (!fs.existsSync(path.join(stagingDir, bundle.keyFile))) {
    throw new Error(
      `${bundle.keyFile} 이 없다 — ${bundle.dirName} 번들이 맞는지 확인하세요 (${source})`,
    );
  }
}

function install(bundle: ImeAssetBundle, source: string, label: string): void {
  const target = targetOf(bundle);
  if (installed(bundle) && !FORCE) {
    console.log(
      `  ${C.yellow}→${C.reset} ${label.padEnd(5)} 이미 있음 — 건너뜀 ${C.dim}(--force 로 덮어쓰기)${C.reset}`,
    );
    return;
  }
  if (!fs.existsSync(source)) throw new Error(`소스가 없다: ${source}`);

  const staging = path.join(HOME, '.staging', `${bundle.dirName}.tmp`);
  try {
    stage(source, staging, bundle);
    fs.writeFileSync(path.join(staging, ASSET_MARKER_FILE), bundle.archive);
    fs.mkdirSync(HOME, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    console.log(`  ${C.green}●${C.reset} ${label.padEnd(5)} ${target}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const PLAN = [
  { bundle: IME_ASSET_BUNDLES.RIME, key: 'rime', label: '중국어' },
  { bundle: IME_ASSET_BUNDLES.MOZC, key: 'mozc', label: '일본어' },
] as const;

console.log(`\n${C.bold}IME 자산${C.reset} ${C.dim}${HOME}${C.reset}\n`);

if (STATUS_ONLY) {
  for (const { bundle, label } of PLAN) report(bundle, label);
  console.log();
  process.exit(0);
}

const sources = PLAN.map((entry) => ({
  ...entry,
  source: sourceOf(entry.bundle, entry.key),
}));

if (sources.every((s) => s.source === undefined)) {
  console.error(
    `${C.red}소스를 못 찾았습니다.${C.reset}\n\n` +
      `  bun scripts/ime-setup.ts --rime <디렉터리|tar.gz> --mozc <디렉터리|tar.gz>\n` +
      `  bun scripts/ime-setup.ts --from dist-ime\n\n` +
      `${C.dim}엔진을 받는 곳은 README 의 "입력기 엔진" 항목을 보세요.${C.reset}\n`,
  );
  process.exit(1);
}

let failed = false;
for (const { bundle, source, label } of sources) {
  if (!source) {
    console.log(
      `  ${C.dim}○${C.reset} ${label.padEnd(5)} 소스 미지정 — 건너뜀${C.reset}`,
    );
    continue;
  }
  try {
    install(bundle, source, label);
  } catch (e) {
    failed = true;
    console.error(
      `  ${C.red}✗${C.reset} ${label.padEnd(5)} ${(e as Error).message}`,
    );
  }
}

console.log(
  `\n${C.dim}엔진이 없는 언어는 실패가 아니라 부재로 다뤄집니다 — ` +
    `자산이 도착하면 다음 요청에서 스스로 붙습니다.${C.reset}\n`,
);
process.exit(failed ? 1 : 0);
