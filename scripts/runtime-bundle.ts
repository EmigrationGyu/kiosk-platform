/**
 * 실행 런타임 번들 조립기 — S3 `/runtime/v3/` 업로드 산출물(tar.gz)을 재현 가능하게 생성.
 *
 * 호스트 런타임에 얹히지 못하는 서브프로세스(32비트 DLL 을 여는 쪽)가 쓸 node 바이너리다.
 * 배포 전략은 IME 자산과 같다: 고정 키 1회 업로드(불변 객체) + 백엔드 "없으면 받기" ensure.
 * 파일명·keyFile·sha256 계약은 kiosk-types 의 `RUNTIME_BUNDLES` 가 단일 진실이다.
 *
 * 실행:
 *   bun scripts/runtime-bundle.ts                 # ia32 번들 조립 → dist-runtime/
 *   bun scripts/runtime-bundle.ts --arch ia32
 *   bun scripts/runtime-bundle.ts --node <path>   # 소스 node 실행파일 지정
 *
 * 산출물은 아키텍처 검증 + 해제 스모크(풀어서 실행해 arch 확인)까지 통과해야 성공으로 친다.
 * 굽고 나면 sha256 을 `RUNTIME_BUNDLES` 와 대조한다 — 어긋나면 굽는 쪽과 받는 쪽이 다른
 * 물건을 보고 있다는 뜻이므로 실패시킨다.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_DATA_DIR } from 'kiosk-types';
// 루트 워크스페이스는 install 없이 쓰는 셸이라 패키지명 대신 상대 경로로 참조한다.
import {
  PROCESS_ARCH,
  type ProcessArch,
  RUNTIME_BUNDLES,
  runtimeSegments,
} from '../kiosk-types/src/types/runtime';
// 플랫폼 종속 조각(tar 바이너리)은 impl 치환 지점 뒤로 격리 — 리눅스 대비.
import { tarBinary } from './lib/host-platform';

const REPO = path.resolve(import.meta.dir, '..');
const OUT_DIR = path.join(REPO, 'dist-runtime');
const TAR = tarBinary();

const argv = Bun.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

type BundledArch = Exclude<ProcessArch, typeof PROCESS_ARCH.HOST>;

const ARCH = (flagValue('--arch') ?? PROCESS_ARCH.IA32) as BundledArch;
if (!(ARCH in RUNTIME_BUNDLES)) {
  throw new Error(
    `번들 계약에 없는 아키텍처: ${ARCH} (가능: ${Object.keys(RUNTIME_BUNDLES).join(', ')})`,
  );
}
const BUNDLE = RUNTIME_BUNDLES[ARCH];

/** 기본 소스 = ensure 가 설치할 자리. 손으로 배치해 둔 것을 그대로 굽는 흐름. */
const DEFAULT_SOURCE = path.join(
  os.homedir(),
  LOCAL_DATA_DIR,
  ...runtimeSegments(ARCH),
  BUNDLE.keyFile,
);
const SOURCE = path.resolve(REPO, flagValue('--node') ?? DEFAULT_SOURCE);

const run = (cmd: string[], label: string): string => {
  const proc = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    throw new Error(
      `${label} 실패 (exit=${proc.exitCode})\n${proc.stderr.toString()}`,
    );
  }
  return proc.stdout.toString().trim();
};

const sha256 = (filePath: string): string =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const freshDir = (dir: string): string => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * 이 바이너리가 정말 그 아키텍처인가 — **실행해서** 묻는다.
 *
 * PE 헤더만 보면 "돌긴 도는가"를 못 본다. x64 호스트는 x86 을 그대로 실행하므로 여기서
 * 실행 검증이 가능하고, 이걸 빼면 x64 node 를 ia32 번들로 구워 올려도 조립은 통과한 뒤
 * 현장에서 DLL 로드 실패로만 드러난다.
 */
const assertArch = (nodePath: string, expected: BundledArch): string => {
  const out = run(
    [nodePath, '-p', "process.arch + ' ' + process.version"],
    '런타임 실행',
  );
  const [arch, version] = out.split(' ');
  if (arch !== expected) {
    throw new Error(`아키텍처 불일치: 기대 ${expected}, 실제 ${arch}`);
  }
  return version ?? 'unknown';
};

// ── 조립 ─────────────────────────────────────────────────────────────────────
console.log(`[runtime:${ARCH}] 소스: ${SOURCE}`);
if (!fs.existsSync(SOURCE)) throw new Error(`소스 실행파일 없음: ${SOURCE}`);

const version = assertArch(SOURCE, ARCH);
console.log(`[runtime:${ARCH}] ${version} ${ARCH} 확인`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const archivePath = path.join(OUT_DIR, BUNDLE.archive);
fs.rmSync(archivePath, { force: true });

// 디렉토리(`.`)가 아니라 **파일 하나**를 지정한다 — 소스 디렉토리에는 ensure 가 남긴
// `.bundle` 마커가 같이 있고, 그건 받는 쪽이 쓰는 장부라 번들에 들어가면 안 된다.
//
// `gzip:!timestamp` 는 재현성을 위한 것이다. gzip 헤더는 기본으로 압축 시각을 담아
// **같은 입력에서도 매번 다른 sha256** 이 나온다(실측: 3회 굽기 = 3개 해시). 그러면
// 아래 계약 대조가 "언제 구웠나"만 보게 되어 무의미해진다. 빼면 같은 소스 → 같은 아카이브다.
run(
  [
    TAR,
    '-czf',
    archivePath,
    '--options',
    'gzip:!timestamp',
    '-C',
    path.dirname(SOURCE),
    BUNDLE.keyFile,
  ],
  'tar 압축',
);

// ── 해제 스모크 ──────────────────────────────────────────────────────────────
const smokeDir = freshDir(path.join(OUT_DIR, '.smoke'));
run([TAR, '-xzf', archivePath, '-C', smokeDir], '스모크 해제');
const extracted = path.join(smokeDir, BUNDLE.keyFile);
if (!fs.existsSync(extracted)) {
  throw new Error(`스모크 실패: ${BUNDLE.keyFile} 이 번들 루트에 없음`);
}
assertArch(extracted, ARCH);
const entries = fs.readdirSync(smokeDir, { recursive: true });
if (entries.length !== 1) {
  throw new Error(`스모크 실패: 번들에 ${BUNDLE.keyFile} 외 항목 ${entries}`);
}
fs.rmSync(smokeDir, { recursive: true, force: true });

// ── 보고 + 계약 대조 ─────────────────────────────────────────────────────────
const digest = sha256(archivePath);
const sizeMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(2);
console.log(`  OK ${BUNDLE.archive}  ${sizeMb}MB`);
console.log(`    sha256=${digest}`);

if (digest !== BUNDLE.sha256) {
  throw new Error(
    [
      '',
      'sha256 이 계약과 다릅니다 — 굽는 쪽과 받는 쪽이 다른 물건을 보고 있습니다.',
      `  계약(RUNTIME_BUNDLES.${ARCH}.sha256): ${BUNDLE.sha256}`,
      `  방금 구운 것                        : ${digest}`,
      '',
      '소스 바이너리를 의도적으로 바꿨다면 archive 파일명(=불변 키)도 함께 갈고',
      'types 의 상수를 교체하세요. 같은 이름으로 내용만 바꾸면 CDN 무효화가 필요해집니다.',
    ].join('\n'),
  );
}

console.log(`\n완료 — 업로드 대상: ${archivePath}`);
console.log(
  `업로드 키: /runtime/v3/${BUNDLE.archive} (덮어쓰기 금지 — 갱신 시 새 파일명)`,
);
