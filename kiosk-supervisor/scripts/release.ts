/**
 * Supervisor 릴리스 — build → sha256 → 서명 → manifest → S3 업로드.
 *
 * GitHub Actions(.github/workflows/release-supervisor.yml)에서 실행한다.
 * 개인키는 GitHub Secret `SUPERVISOR_SIGNING_KEY`(PKCS8 PEM)에서 env 로 주입되며
 * 절대 레포/로컬에 두지 않는다. 로컬 점검은 `DRY_RUN=1` 로 업로드 없이 build+sign 만.
 *
 * 필요 env:
 *   SUPERVISOR_VERSION   릴리스 버전 (워크플로 bump 단계가 계산)
 *   SUPERVISOR_BUCKET    S3 버킷 (vars.KIOSK_APP_BUCKET_NAME)
 *   SUPERVISOR_SIGNING_KEY  개인키 PKCS8 PEM (GitHub Secret)
 *   AWS_REGION           (기본 ap-northeast-2)
 *   DRY_RUN=1            업로드 생략 (로컬 점검용)
 *
 * bootstrap.js 는 동결 앵커라 여기서 배포하지 않는다 (USB 만). loader/daemon 만 S3.
 */

import { ManifestSchema } from '../src/types';

const PREFIX = 'kiosk-supervisor';
const SIGN_ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const VERSION = required('SUPERVISOR_VERSION');
const BUCKET = required('SUPERVISOR_BUCKET');
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const PRIVATE_KEY_PEM = required('SUPERVISOR_SIGNING_KEY');
const DRY = process.env.DRY_RUN === '1';

const httpsBase = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${PREFIX}`;

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer as ArrayBuffer;
}

let signingKey: CryptoKey | null = null;
async function sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (!signingKey) {
    signingKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(PRIVATE_KEY_PEM),
      SIGN_ALGO,
      false,
      ['sign'],
    );
  }
  return new Uint8Array(
    await crypto.subtle.sign(SIGN_ALGO.name, signingKey, data),
  );
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if ((await proc.exited) !== 0) throw new Error(`failed: ${cmd.join(' ')}`);
}

/** 자식 스크립트 하나를 빌드 + 서명 + manifest 작성 + 업로드. */
async function release(
  name: 'loader' | 'daemon',
  entry: string,
): Promise<void> {
  const out = `dist/${name}.js`;
  console.log(`\n=== ${name} v${VERSION} ===`);

  // 1) 빌드 (임베드 값 주입)
  await run([
    'bun',
    'build',
    entry,
    '--target',
    'bun',
    '--minify',
    '--outfile',
    out,
    '--define',
    `process.env.SUPERVISOR_VERSION=${JSON.stringify(VERSION)}`,
    '--define',
    `process.env.SUPERVISOR_S3_BASE=${JSON.stringify(httpsBase)}`,
  ]);

  // 2) sha256 + 서명
  const buf = new Uint8Array(await Bun.file(out).arrayBuffer());
  const sha256 = new Bun.CryptoHasher('sha256').update(buf).digest('hex');
  const sig = await sign(buf);
  await Bun.write(`${out}.sig`, sig);

  // 3) manifest (types 의 ManifestSchema 로 형태 검증)
  const verDir = `${PREFIX}/${name}/${VERSION}`;
  const manifest = ManifestSchema.parse({
    version: VERSION,
    url: `${httpsBase}/${name}/${VERSION}/${name}.js`,
    sigUrl: `${httpsBase}/${name}/${VERSION}/${name}.js.sig`,
    sha256,
    minLoaderVersion: '0.0.0',
    publishedAt: new Date().toISOString(),
  });
  const manifestPath = `dist/${name}.latest.json`;
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  sha256=${sha256}`);

  if (DRY) {
    console.log(`  [dry-run] skip upload (${verDir}/ + latest.json)`);
    return;
  }

  // 4) 업로드 — 아티팩트는 불변(장기 캐시), 매니페스트는 no-cache.
  const immutable = 'public, max-age=31536000, immutable';
  await run([
    'aws',
    's3',
    'cp',
    out,
    `s3://${BUCKET}/${verDir}/${name}.js`,
    '--cache-control',
    immutable,
  ]);
  await run([
    'aws',
    's3',
    'cp',
    `${out}.sig`,
    `s3://${BUCKET}/${verDir}/${name}.js.sig`,
    '--cache-control',
    immutable,
  ]);
  await run([
    'aws',
    's3',
    'cp',
    manifestPath,
    `s3://${BUCKET}/${PREFIX}/${name}/latest.json`,
    '--cache-control',
    'no-cache',
  ]);
  console.log(`  uploaded → s3://${BUCKET}/${PREFIX}/${name}/`);
}

await release('loader', 'src/loader.ts');
await release('daemon', 'src/daemon/index.ts');
console.log('\n✓ release done');
