/**
 * USB ZIP 패키저 (수동, 가끔 실행). 자동업데이트 인프라가 아니라 "초기 1회 설치본".
 *
 *   - bootstrap.js : 로컬에서 프로덕션 S3 URL 박아 빌드 (동결 앵커, S3 에 게시 안 함)
 *   - loader.js / daemon.js : S3 에 게시된 최신본을 공개 HTTPS 로 다운로드 (자격증명 불필요)
 *   - bun.exe / nssm.exe / install.ps1 / uninstall.ps1 : installer/ 에서 복사
 *   → dist/kiosk-supervisor-<version>.zip
 *
 * 선행: CI 가 enableUpdate=true 버전을 S3 에 게시한 뒤 실행할 것.
 * env SUPERVISOR_S3_BASE 로 베이스 URL 재정의 가능(기본 = 프로덕션 버킷).
 */

import { ManifestSchema } from '../src/types';

const S3_BASE =
  process.env.SUPERVISOR_S3_BASE ??
  'https://kiosk-artifacts-example.s3.ap-northeast-2.amazonaws.com/kiosk-supervisor';

const STAGE = 'dist/pkg';

async function sh(cmd: string[]): Promise<void> {
  const p = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(' ')}`);
}

async function fetchTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  await Bun.write(dest, await r.arrayBuffer());
}

/** S3 latest.json 에서 최신본 + 서명을 받아 스테이지에 배치하고, .version 도 기록. */
async function pull(name: 'loader' | 'daemon'): Promise<string> {
  const manifest = ManifestSchema.parse(
    await (await fetch(`${S3_BASE}/${name}/latest.json`)).json(),
  );
  const ver = manifest.version;
  console.log(`  ${name}: ${ver}`);
  await fetchTo(`${S3_BASE}/${name}/${ver}/${name}.js`, `${STAGE}/${name}.js`);
  await fetchTo(
    `${S3_BASE}/${name}/${ver}/${name}.js.sig`,
    `${STAGE}/${name}.js.sig`,
  );
  // 번들 버전 표식 — 박스가 첫 폴링 때 불필요한 재다운로드를 피함.
  await Bun.write(`${STAGE}/${name}.js.version`, ver);
  return ver;
}

// 0) 스테이지 초기화
await sh([
  'powershell',
  '-NoProfile',
  '-Command',
  `Remove-Item -Recurse -Force '${STAGE}' -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force -Path '${STAGE}' | Out-Null`,
]);

// 1) bootstrap.js — 프로덕션 S3 URL 박아 로컬 빌드 (동결 앵커)
console.log('building bootstrap.js (prod URL embedded)...');
await sh([
  'bun',
  'build',
  'src/bootstrap.ts',
  '--target',
  'bun',
  '--outfile',
  `${STAGE}/bootstrap.js`,
  '--define',
  `process.env.SUPERVISOR_S3_BASE=${JSON.stringify(S3_BASE)}`,
]);

// 2) loader/daemon — S3 최신본 다운로드
console.log('pulling published loader/daemon from S3...');
const loaderVer = await pull('loader');
await pull('daemon');

// 3) installer 정적 자산 복사
for (const f of ['bun.exe', 'nssm.exe', 'install.ps1', 'uninstall.ps1']) {
  await sh([
    'powershell',
    '-NoProfile',
    '-Command',
    `Copy-Item 'installer/${f}' '${STAGE}/${f}' -Force`,
  ]);
}

// 4) zip
const zip = `dist/kiosk-supervisor-${loaderVer}.zip`;
await sh([
  'powershell',
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${STAGE}/*' -DestinationPath '${zip}' -Force`,
]);
console.log(`\n✓ ${zip}`);
