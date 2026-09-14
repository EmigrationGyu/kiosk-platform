/**
 * dist 하나를 **받을 수 있는 산출물**로 굽는다 — 아카이브·서명·서술자.
 *
 * CI 와 하네스가 **같은 이 코드**를 부른다. 굽는 방법이 두 벌이면 하네스로 검증한 모양과
 * CI 가 올리는 모양이 갈리고, 그러면 "실기기에서 확인했다"가 거짓말이 된다.
 *
 * 서명은 `node:crypto` 로 한다 — openssl 유무나 러너 OS 를 타지 않는다.
 *
 *   bun scripts/ci/bake-artifact.ts --dist <디렉토리> --out <디렉토리> \
 *     --prefix <S3 prefix> --version <버전> --base-url <URL> [--key <개인키.pem>]
 *
 * 개인키는 `--key` 또는 env `KIOSK_COMPONENT_SIGNING_KEY`.
 */
import { spawnSync } from 'node:child_process';
import { createHash, createSign } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import CONTRACT from '../../kiosk-types/contract.json' with { type: 'json' };
import {
  ARTIFACT_ARCHIVE,
  ARTIFACT_DESCRIPTOR,
  ARTIFACT_SIGNATURE,
} from '../../kiosk-types/src/update/artifact';
import type { UpdateComponent } from '../../kiosk-types/src/update/components';
import { UPDATE_COMPONENT } from '../../kiosk-types/src/update/components';
import { artifactSurfacesFor } from '../../kiosk-types/src/update/surfaces';

/** 설치본(base) 같은 비컴포넌트는 표면이 없다 — 조합을 따질 대상이 아니다. */
const surfacesOf = (component: string) => {
  const known =
    component === UPDATE_COMPONENT.FRONTEND ||
    component === UPDATE_COMPONENT.BACKEND ||
    component in CONTRACT.processes;
  return known
    ? artifactSurfacesFor(component as UpdateComponent, CONTRACT)
    : undefined;
};

export type BakeResult = { archiveBytes: number; sha256: string };

export function bakeArtifact(options: {
  /** 담을 내용이 들어 있는 디렉토리(= 세대 디렉토리가 될 것). */
  distDir?: string;
  /** 이미 하나의 파일인 산출물(설치본). 주면 아카이브를 만들지 않는다. */
  filePath?: string;
  /** 구운 세 파일을 놓을 곳. */
  outDir: string;
  /** S3 prefix (`artifactPrefix(component)`). */
  prefix: string;
  /** 컴포넌트 식별자 — 콘솔이 prefix 에서 역으로 추측하지 않아도 되게 실어 보낸다. */
  component: string;
  version: string;
  /**
   * 사람이 읽는 변경 요약 — 운영자가 배포를 고르는 순간 읽는 값이다. 커밋 제목으로 자동
   * 채우지 않는 이유: 개발자 어휘 문장은 판단에 못 쓰면서 "설명이 있다"고 보여 빈칸보다
   * 해롭다. 비면(빈 문자열 포함) 서술자에 키 자체가 없다.
   *
   * ⚠ 버킷이 전체 public read — 업장명·고객명·취약점 상세는 싣지 않는다.
   */
  description?: string;
  /** `https://{bucket}.s3.{region}.amazonaws.com` */
  baseUrl: string;
  privateKeyPem: string;
}): BakeResult {
  const {
    distDir,
    filePath,
    outDir,
    prefix,
    component,
    version,
    baseUrl,
    privateKeyPem,
  } = options;
  if (!distDir === !filePath) {
    throw new Error('--dist 와 --file 중 하나만 주세요');
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 파일 하나면 그대로 옮긴다 — 설치본은 아카이브로 묶어봐야 얻는 것이 없다.
  // 디렉토리면 **안쪽**을 담는다: 푼 결과가 곧 세대 디렉토리 내용이어야 한다.
  // cwd 를 옮기는 이유는 extract 쪽과 같다: GNU tar 는 인자 속 `C:` 를 원격 호스트로 읽는다.
  const payloadName = filePath ? path.basename(filePath) : ARTIFACT_ARCHIVE;
  const payloadPath = path.join(outDir, payloadName);
  if (filePath) {
    copyFileSync(filePath, payloadPath);
  } else {
    const tar = spawnSync(
      'tar',
      [
        '-czf',
        path
          .relative(distDir as string, payloadPath)
          .split(path.sep)
          .join('/'),
        '.',
      ],
      { cwd: distDir, encoding: 'utf-8' },
    );
    if (tar.status !== 0) {
      throw new Error(`tar 실패(status=${tar.status}): ${tar.stderr?.trim()}`);
    }
  }

  const archive = readFileSync(payloadPath);
  const sha256 = createHash('sha256').update(archive).digest('hex');

  const signer = createSign('RSA-SHA256');
  signer.update(archive);
  const signatureName = filePath ? `${payloadName}.sig` : ARTIFACT_SIGNATURE;
  writeFileSync(path.join(outDir, signatureName), signer.sign(privateKeyPem));

  const versionUrl = `${baseUrl.replace(/\/+$/, '')}/${prefix}/${version}`;
  writeFileSync(
    path.join(outDir, ARTIFACT_DESCRIPTOR),
    `${JSON.stringify(
      {
        descriptorVersion: 1,
        version,
        component,
        // 조합이 말이 통하는지의 근거. 콘솔이 **고르기 전에** 알아야 하므로 여기 싣는다.
        // 판정은 surfaces(관계 단위)가 하고, total 은 "완전 동세트" 참고 표시다.
        contractTotal: CONTRACT.total,
        ...(surfacesOf(component) ? { surfaces: surfacesOf(component) } : {}),
        bakedAt: new Date().toISOString(),
        ...(options.description ? { description: options.description } : {}),
        url: `${versionUrl}/${payloadName}`,
        sha256,
        sigUrl: `${versionUrl}/${signatureName}`,
      },
      null,
      2,
    )}\n`,
  );

  return { archiveBytes: archive.length, sha256 };
}

/** 개인키를 읽는다 — 경로가 주어지면 파일, 아니면 env. */
export function readSigningKey(keyPath?: string): string {
  if (keyPath) return readFileSync(keyPath, 'utf-8');
  const fromEnv = process.env.KIOSK_COMPONENT_SIGNING_KEY;
  if (!fromEnv) {
    throw new Error(
      '개인키가 없습니다 — --key <경로> 또는 KIOSK_COMPONENT_SIGNING_KEY',
    );
  }
  return fromEnv;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? undefined : args[at + 1];
  };

  const required = (name: string): string => {
    const value = flag(name);
    if (!value) {
      console.error(`--${name} 이 필요합니다`);
      process.exit(1);
    }
    return value;
  };

  const result = bakeArtifact({
    ...(flag('file')
      ? { filePath: flag('file') }
      : { distDir: required('dist') }),
    outDir: required('out'),
    prefix: required('prefix'),
    component: required('component'),
    version: required('version'),
    description: flag('description'),
    baseUrl: required('base-url'),
    privateKeyPem: readSigningKey(flag('key')),
  });
  console.log(
    `구움: ${required('prefix')}@${required('version')} ${result.archiveBytes} bytes sha=${result.sha256.slice(0, 12)}`,
  );
}
