/**
 * IME 자산 번들 조립기 — S3 `/ime/v3/` 업로드 산출물(tar.gz 2개)을 재현 가능하게 생성.
 *
 * 배포 전략(B안): 고정 키 1회 업로드(불변 객체) + 백엔드 "없으면 받기" ensure.
 * 파일명/검증 파일 등 계약은 kiosk-types 의 IME_ASSET_BUNDLES 가 단일 진실.
 *
 * 입력:
 *   - mozc: Mozc64.msi → `msiexec /a`(무등록 추출) → 캐리셋 선별
 *     (server + broker + renderer + tip64 + CRT — tool/cache_service/Qt/tip32 제외)
 *   - rime: 큐레이션 완료된 rime 데이터 디렉토리(기본 ~/.kiosk/rime), user/(런타임 산물) 제외
 *
 * 실행:
 *   bun scripts/ime-bundle.ts                       # 둘 다 조립 → dist-ime/
 *   bun scripts/ime-bundle.ts --msi <path>          # MSI 경로 지정 (기본: ./Mozc64.msi)
 *   bun scripts/ime-bundle.ts --rime-dir <path>     # rime 소스 지정 (기본: ~/.kiosk/rime)
 *   bun scripts/ime-bundle.ts --skip-mozc|--skip-rime
 *
 * 각 산출물은 해제 스모크 테스트(핵심 파일 존재 + user/ 미포함)까지 통과해야 성공으로 친다.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 루트 워크스페이스는 install 없이 쓰는 셸이라 패키지명 대신 상대 경로로 참조한다.
import { IME_ASSET_BUNDLES } from '../kiosk-types/src/types/ime';
import { LOCAL_DATA_DIR } from '../kiosk-types/src/update/components';
// 플랫폼 종속 조각(tar 바이너리·MSI 추출)은 impl 치환 지점 뒤로 격리 — 리눅스 대비.
import { msiExtractCommand, tarBinary } from './lib/host-platform';

const REPO = path.resolve(import.meta.dir, '..');
const OUT_DIR = path.join(REPO, 'dist-ime');
const TAR = tarBinary();

const argv = Bun.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const MSI_PATH = path.resolve(REPO, flagValue('--msi') ?? 'Mozc64.msi');
const RIME_DIR =
  flagValue('--rime-dir') ?? path.join(os.homedir(), LOCAL_DATA_DIR, 'rime');
const SKIP_MOZC = argv.includes('--skip-mozc');
const SKIP_RIME = argv.includes('--skip-rime');

// mozc 캐리셋 — 조립 시점에만 필요한 지식이라 여기 둔다.
// renderer 포함 이유: broker prelaunch 가 renderer 부재를 어떻게 다루는지 미검증이라
// 2MB 보험으로 동봉(실기기 검증 후 슬림화 여지). tip64 는 프로비저닝 레지스트리 키가
// 가리킬 실체. tip32(32bit TSF)/tool·cache_service(관리 GUI/서비스)/Qt(tool 전용)는 제외.
const MOZC_CARRY_SET = [
  'mozc_server.exe',
  'mozc_broker.exe',
  'mozc_renderer.exe',
  'mozc_tip64.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];

const run = (cmd: string[], label: string): void => {
  const proc = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    throw new Error(
      `${label} 실패 (exit=${proc.exitCode})\n${proc.stderr.toString()}`,
    );
  }
};

const sha256 = (filePath: string): string =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const freshDir = (dir: string): string => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** 해제 스모크: 클린 디렉토리에 풀어 핵심 파일 존재(+금지 경로 부재)를 확인. */
const smokeTest = (
  archivePath: string,
  keyFile: string,
  forbidden?: string,
): number => {
  const dir = freshDir(path.join(OUT_DIR, '.smoke'));
  run([TAR, '-xzf', archivePath, '-C', dir], '스모크 해제');
  if (!fs.existsSync(path.join(dir, keyFile))) {
    throw new Error(`스모크 실패: ${keyFile} 이 번들에 없음`);
  }
  if (forbidden && fs.existsSync(path.join(dir, forbidden))) {
    throw new Error(`스모크 실패: 제외 대상 ${forbidden}/ 이 번들에 포함됨`);
  }
  const count = fs.readdirSync(dir, { recursive: true }).length;
  fs.rmSync(dir, { recursive: true, force: true });
  return count;
};

const report = (archivePath: string, entryCount: number): void => {
  const size = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(2);
  console.log(
    `  OK ${path.basename(archivePath)}  ${size}MB  entries=${entryCount}`,
  );
  console.log(`    sha256=${sha256(archivePath)}`);
};

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── mozc ─────────────────────────────────────────────────────────────────────
if (!SKIP_MOZC) {
  console.log(`[mozc] MSI 추출: ${MSI_PATH}`);
  if (!fs.existsSync(MSI_PATH)) throw new Error(`MSI 없음: ${MSI_PATH}`);

  const extractDir = freshDir(path.join(OUT_DIR, '.msi-extract'));
  run(msiExtractCommand(MSI_PATH, extractDir), 'msi 추출');

  const sourceDir = path.join(extractDir, 'PFiles', 'Mozc');
  const stageDir = freshDir(path.join(OUT_DIR, '.mozc-stage'));
  for (const file of MOZC_CARRY_SET) {
    const src = path.join(sourceDir, file);
    if (!fs.existsSync(src)) throw new Error(`캐리셋 파일 없음: ${src}`);
    fs.copyFileSync(src, path.join(stageDir, file));
  }

  const archivePath = path.join(OUT_DIR, IME_ASSET_BUNDLES.MOZC.archive);
  run([TAR, '-czf', archivePath, '-C', stageDir, '.'], 'mozc tar');
  const entries = smokeTest(archivePath, IME_ASSET_BUNDLES.MOZC.keyFile);
  report(archivePath, entries);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
}

// ── rime ─────────────────────────────────────────────────────────────────────
if (!SKIP_RIME) {
  console.log(`[rime] 소스: ${RIME_DIR}`);
  if (!fs.existsSync(path.join(RIME_DIR, IME_ASSET_BUNDLES.RIME.keyFile))) {
    throw new Error(
      `rime 소스가 큐레이션 데이터가 아님(rime.dll 없음): ${RIME_DIR}`,
    );
  }

  const archivePath = path.join(OUT_DIR, IME_ASSET_BUNDLES.RIME.archive);
  // user/ = 런타임 산물(학습 userdb + deploy build 캐시) — 번들에서 제외.
  run(
    [TAR, '-czf', archivePath, '-C', RIME_DIR, '--exclude', './user', '.'],
    'rime tar',
  );
  const entries = smokeTest(
    archivePath,
    IME_ASSET_BUNDLES.RIME.keyFile,
    'user',
  );
  report(archivePath, entries);
}

console.log(`\n완료 — 업로드 대상: ${OUT_DIR}`);
console.log(
  `업로드 키: /ime/v3/${IME_ASSET_BUNDLES.RIME.archive}, /ime/v3/${IME_ASSET_BUNDLES.MOZC.archive} (덮어쓰기 금지 — 갱신 시 새 파일명)`,
);
