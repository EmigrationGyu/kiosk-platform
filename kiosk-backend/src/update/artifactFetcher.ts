import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  ARTIFACT_ARCHIVE,
  ARTIFACT_DESCRIPTOR,
  ARTIFACT_SIGNATURE,
  ArtifactDescriptorSchema,
  artifactVersionUrl,
  baseVersionUrl,
  generationSegments,
  type Manifest,
  type UpdateComponent,
} from 'kiosk-types';
import { sha256Hex } from './signing';

/**
 * 세대(와 앱 설치본)를 S3 에서 받아 디스크에 놓는다.
 *
 * **검증에 실패하면 던진다 — 절대 통과시키지 않는다.** 받은 바이트를 믿을 근거는 서명 하나뿐이고,
 * 그게 없으면 공개 버킷은 그냥 아무나 쓴 코드일 수 있다.
 *
 * 받는 시점은 **적용 직전**이다(안전한 화면에서 렌더러가 요청) — 그래서 오래 걸려도 게이트가 잠긴 채
 * 매달리지 않는다. 이미 있는 세대는 건너뛴다(되감았다 다시 올라가는 경우가 흔하다).
 */
export type ArtifactFetcher = {
  /**
   * 매니페스트가 요구하는 것을 전부 디스크에 확보한다. 하나라도 실패하면 throw.
   *
   * `base` 매니페스트면 받아둔 설치본의 절대 경로를 돌려준다 — 파일 이름이 서술자에서
   * 오므로, 나중에 디렉토리를 뒤져 찾게 두지 않고 받은 쪽이 그대로 알려준다.
   */
  ensure(manifest: Manifest): Promise<{ baseInstaller: string | null }>;
  /**
   * 지금 돌고 있는 버전의 설치본을 치운다. 설치가 반영된 순간 그 설치본은 쓸모가 끝난다(되감기에는
   * 애초에 못 쓴다 — 지금 돌고 있는 바로 그 버전이다). 그런데 **반영을 확인할 수 있는 유일한 순간**
   * (부팅 직후)은 setup.exe 가 아직 그 파일을 쥐고 있는 순간이기도 해서, 확인한 쪽이 지우지 않고
   * 잠금과 무관한 시점에 도는 이쪽이 치운다.
   */
  sweepInstalled(version: string): void;
};

export function createArtifactFetcher(deps: {
  artifactRoot: string;
  /** 설치본을 받아 둘 곳(`~/.kiosk/update`) — 설치가 지우지 않는 자리여야 한다. */
  baseRoot: string;
  /** `https://{bucket}.s3.{region}.amazonaws.com` — 빌드 시 주입된다. */
  baseUrl: string;
  hasGeneration(component: UpdateComponent, generation: string): boolean;
  /** 아카이브를 디렉토리에 푼다(윈도우 내장 tar). */
  extract(archivePath: string, destDir: string): void;
  verify(
    data: Uint8Array<ArrayBuffer>,
    signature: Uint8Array<ArrayBuffer>,
  ): Promise<boolean>;
  fetch: typeof fetch;
  onLog(message: string): void;
}): ArtifactFetcher {
  const { artifactRoot, baseRoot, baseUrl, extract, verify, onLog } = deps;

  async function get(url: string): Promise<Uint8Array<ArrayBuffer>> {
    const res = await deps.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // 받아야 하는 순간에만 따진다 — 전부 디스크에 있으면 받아올 곳을 몰라도 된다
  // (하네스가 로컬 빌드로 세대를 놓아두는 경로가 그렇다).
  function requireBaseUrl(label: string, version: string): void {
    if (baseUrl.length === 0) {
      throw new Error(
        `받아올 곳을 모릅니다(ARTIFACT_BASE_URL 비어 있음): ${label}@${version}`,
      );
    }
  }

  /** 서술자를 읽고 payload 를 받아 대조·검증한다. 하나라도 어긋나면 던진다. */
  async function fetchVerified(
    label: string,
    versionUrl: string,
    version: string,
  ): Promise<{ url: string; payload: Uint8Array<ArrayBuffer> }> {
    const descriptor = ArtifactDescriptorSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          await get(`${versionUrl}/${ARTIFACT_DESCRIPTOR}`),
        ),
      ),
    );
    // 서술자가 다른 버전을 가리키면 경로와 내용이 어긋난 것이다 — 받지 않는다.
    if (descriptor.version !== version) {
      throw new Error(
        `서술자 버전 불일치: ${label} 경로=${version} 서술자=${descriptor.version}`,
      );
    }

    const payload = await get(descriptor.url);
    const actual = await sha256Hex(payload);
    if (actual !== descriptor.sha256) {
      throw new Error(
        `sha256 불일치: ${label}@${version} ${actual} != ${descriptor.sha256}`,
      );
    }
    if (!(await verify(payload, await get(descriptor.sigUrl)))) {
      throw new Error(`서명 검증 실패: ${label}@${version}`);
    }
    return { url: descriptor.url, payload };
  }

  async function fetchOne(
    component: UpdateComponent,
    version: string,
  ): Promise<void> {
    requireBaseUrl(component, version);
    const { payload } = await fetchVerified(
      component,
      artifactVersionUrl(baseUrl, component, version),
      version,
    );
    place(component, version, payload);
    onLog(`받음: ${component}@${version} (${payload.length} bytes)`);
  }

  async function fetchBase(version: string): Promise<string> {
    requireBaseUrl('base', version);
    const { url, payload } = await fetchVerified(
      'base',
      baseVersionUrl(baseUrl, version),
      version,
    );
    // 파일 이름은 서술자가 정한다 — 상수로 또 적으면 CI 가 바꿨을 때 조용히 어긋난다.
    const installer = placeBase(
      version,
      path.basename(new URL(url).pathname),
      payload,
    );
    onLog(`받음: base@${version} (${payload.length} bytes) → ${installer}`);
    return installer;
  }

  /**
   * staging 에 풀고 rename — 중간 상태가 남으면 다음 부팅이 반쯤 받은 세대를 실행한다. 세대 디렉토리는
   * **완성된 것만** 존재하므로 `hasGeneration`(디렉토리 존재)이 곧 "쓸 수 있다"는 뜻이 된다.
   */
  function place(
    component: UpdateComponent,
    version: string,
    archive: Uint8Array<ArrayBuffer>,
  ): void {
    const target = path.join(
      artifactRoot,
      ...generationSegments(component, version),
    );
    const staging = `${target}.staging`;
    const archivePath = `${staging}.tar.gz`;

    // 지난번 시도가 끊겼을 수 있다 — 남은 것을 치우고 시작한다.
    rmSync(staging, { recursive: true, force: true });
    rmSync(archivePath, { force: true });
    mkdirSync(staging, { recursive: true });
    try {
      writeFileSync(archivePath, archive);
      extract(archivePath, staging);
      renameSync(staging, target);
    } finally {
      rmSync(archivePath, { force: true });
      // rename 이 성공했으면 staging 은 이미 없다.
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /**
   * 설치본도 staging → rename 으로 놓는다 — 디렉토리가 있으면 완성됐다는 뜻이다.
   * 반쯤 받은 256MB 를 실행하면 설치가 어디까지 갔는지 모르는 상태로 끝난다.
   */
  function placeBase(
    version: string,
    fileName: string,
    installer: Uint8Array<ArrayBuffer>,
  ): string {
    const target = path.join(baseRoot, version);
    const staging = `${target}.staging`;

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    try {
      writeFileSync(path.join(staging, fileName), installer);
      renameSync(staging, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return path.join(target, fileName);
  }

  /**
   * 받아둔 설치본은 **하나만** 남긴다. 옛 설치본은 쓸 데가 없고(설치가 끝나면 그 버전이 되며 base 는
   * 되감지 않는다) 버전당 256MB 라 그냥 두면 몇 해 도는 단말에서 디스크가 말라붙는다. 끊긴 시도가 남긴
   * `.staging` 도 함께 사라진다. 디렉토리만 지운다 — 같은 자리에 적용 기록이 파일로 놓인다.
   */
  function sweepBase(keep: string): void {
    if (!existsSync(baseRoot)) return;
    for (const entry of readdirSync(baseRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === keep) continue;
      sweepOne(entry.name);
    }
  }

  /** 이 버전의 설치본을 치운다. 없으면 아무것도 하지 않는다. */
  function sweepOne(version: string): void {
    const dir = path.join(baseRoot, version);
    if (!existsSync(dir)) return;
    rmSync(dir, { recursive: true, force: true });
    onLog(`치움: base@${version}`);
  }

  /** 이미 받아둔 설치본(없으면 null). */
  function existingBase(version: string): string | null {
    const dir = path.join(baseRoot, version);
    if (!existsSync(dir)) return null;
    const [fileName] = readdirSync(dir);
    return fileName ? path.join(dir, fileName) : null;
  }

  return {
    sweepInstalled: sweepOne,

    async ensure(manifest) {
      // base 와 components 는 함께 오지 않는다(스키마가 막는다) — 설치본이 세대를 전부
      // 새로 놓으므로 같이 보내는 것은 뜻이 성립하지 않는다.
      if (manifest.base !== undefined) {
        const already = existingBase(manifest.base);
        if (already) onLog(`이미 있음: base@${manifest.base}`);
        const installer = already ?? (await fetchBase(manifest.base));
        sweepBase(manifest.base);
        return { baseInstaller: installer };
      }

      const wanted = Object.entries(manifest.components) as [
        UpdateComponent,
        string,
      ][];

      for (const [component, version] of wanted) {
        if (deps.hasGeneration(component, version)) {
          onLog(`이미 있음: ${component}@${version}`);
          continue;
        }
        await fetchOne(component, version);
      }
      return { baseInstaller: null };
    },
  };
}

/** 아카이브 이름은 계약이다 — CI 가 올리는 것과 같아야 한다. */
export { ARTIFACT_ARCHIVE, ARTIFACT_SIGNATURE };
