import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Manifest } from 'kiosk-types';
import { createArtifactFetcher } from './artifactFetcher';
import { sha256Hex } from './signing';

const BASE = 'https://bucket.s3.ap-northeast-2.amazonaws.com';
const ARCHIVE = new TextEncoder().encode(
  '아카이브 내용',
) as Uint8Array<ArrayBuffer>;

let root: string;
let baseRoot: string;

const manifest = (components: Manifest['components']): Manifest => ({
  manifestVersion: 1,
  components,
});

const baseManifest = (base: string): Manifest => ({
  manifestVersion: 1,
  components: {},
  base,
});

/** 서술자·아카이브·서명을 URL 로 돌려주는 가짜 S3. */
function fakeS3(overrides?: {
  descriptor?: Record<string, unknown>;
  archive?: Uint8Array<ArrayBuffer>;
}) {
  const requested: string[] = [];
  const archive = overrides?.archive ?? ARCHIVE;

  const serve = async (url: string): Promise<Response> => {
    requested.push(url);
    if (url.endsWith('/artifact.json')) {
      const sha = await sha256Hex(archive);
      const version = url.split('/').at(-2) as string;
      const dir = url.slice(0, url.lastIndexOf('/'));
      // 설치본은 아카이브가 아니라 exe 한 개다 — 이름이 서술자에서 온다.
      const payload = url.includes('/kiosk-electron/')
        ? 'Kiosk-Setup.exe'
        : 'dist.tar.gz';
      return Response.json({
        descriptorVersion: 1,
        version,
        url: `${dir}/${payload}`,
        sha256: sha,
        sigUrl: `${dir}/${payload}.sig`,
        ...overrides?.descriptor,
      });
    }
    if (url.endsWith('.sig')) return new Response(new Uint8Array([1, 2, 3]));
    return new Response(archive);
  };

  return { serve: serve as unknown as typeof fetch, requested };
}

function build(options?: {
  s3?: ReturnType<typeof fakeS3>;
  verified?: boolean;
  present?: string[];
  onExtract?: (archivePath: string, dest: string) => void;
}) {
  const s3 = options?.s3 ?? fakeS3();
  const present = new Set(options?.present ?? []);
  const logs: string[] = [];
  const extracted: string[] = [];

  const fetcher = createArtifactFetcher({
    artifactRoot: root,
    baseRoot,
    baseUrl: BASE,
    hasGeneration: (component, generation) =>
      present.has(`${component}@${generation}`),
    extract: (archivePath, dest) => {
      extracted.push(dest);
      options?.onExtract?.(archivePath, dest);
      // 실제 tar 대신 파일 하나를 놓는다 — 푼 결과가 target 으로 옮겨지는지만 본다.
      // **동기**여야 한다: 핸들이 열린 채로 rename 하면 Windows 가 EPERM 을 던진다.
      writeFileSync(path.join(dest, 'index.js'), 'unpacked');
    },
    verify: async () => options?.verified ?? true,
    fetch: s3.serve,
    onLog: (m) => logs.push(m),
  });

  return { fetcher, s3, logs, extracted };
}

const generationDir = (component: string, version: string) =>
  component === 'frontend' || component === 'backend'
    ? path.join(root, component, '.generations', version)
    : path.join(root, 'serialport', component, '.generations', version);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'fetcher-'));
  baseRoot = mkdtempSync(path.join(tmpdir(), 'fetcher-base-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(baseRoot, { recursive: true, force: true });
});

describe('산출물 받기', () => {
  test('받아서 세대 디렉토리에 놓는다', async () => {
    const h = build();

    await h.fetcher.ensure(manifest({ frontend: '1.24.0' }));

    expect(existsSync(generationDir('frontend', '1.24.0'))).toBe(true);
  });

  test('CI 가 올린 경로에서 찾는다 — prefix 가 어긋나면 아무것도 못 받는다 ★', async () => {
    const h = build();

    await h.fetcher.ensure(
      manifest({ frontend: '1.24.0', 'token-dispenser': '0.3.1' }),
    );

    expect(h.s3.requested).toContain(
      `${BASE}/kiosk-frontend/1.24.0/artifact.json`,
    );
    expect(h.s3.requested).toContain(
      `${BASE}/token-dispenser/0.3.1/artifact.json`,
    );
  });

  test('이미 있는 세대는 받지 않는다 — 되감았다 올라올 때 19MB 를 또 받을 이유가 없다', async () => {
    const h = build({ present: ['frontend@1.24.0'] });

    await h.fetcher.ensure(manifest({ frontend: '1.24.0' }));

    expect(h.s3.requested).toEqual([]);
  });
});

describe('받아올 곳', () => {
  test('전부 디스크에 있으면 base URL 을 몰라도 된다 — 하네스가 로컬 빌드를 놓는 경로다 ★', async () => {
    const fetcher = createArtifactFetcher({
      artifactRoot: root,
      baseRoot,
      baseUrl: '',
      hasGeneration: () => true,
      extract: () => undefined,
      verify: async () => true,
      fetch: (async () => {
        throw new Error('받으러 가면 안 된다');
      }) as unknown as typeof fetch,
      onLog: () => undefined,
    });

    await fetcher.ensure(manifest({ frontend: '1.24.0' }));
  });

  test('받아야 하는데 base URL 이 없으면 던진다 — 조용히 엉뚱한 데서 받지 않는다 ★', async () => {
    const fetcher = createArtifactFetcher({
      artifactRoot: root,
      baseRoot,
      baseUrl: '',
      hasGeneration: () => false,
      extract: () => undefined,
      verify: async () => true,
      fetch: (async () => new Response('')) as unknown as typeof fetch,
      onLog: () => undefined,
    });

    await expect(
      fetcher.ensure(manifest({ frontend: '1.24.0' })),
    ).rejects.toThrow(/받아올 곳을 모릅니다/);
  });
});

describe('검증에 실패하면 통과시키지 않는다', () => {
  test('sha256 이 다르면 던진다 ★', async () => {
    const h = build({ s3: fakeS3({ descriptor: { sha256: 'b'.repeat(64) } }) });

    await expect(
      h.fetcher.ensure(manifest({ frontend: '1.24.0' })),
    ).rejects.toThrow(/sha256 불일치/);
    expect(existsSync(generationDir('frontend', '1.24.0'))).toBe(false);
  });

  test('서명이 맞지 않으면 던진다 — 공개 버킷의 유일한 방어선이다 ★', async () => {
    const h = build({ verified: false });

    await expect(
      h.fetcher.ensure(manifest({ frontend: '1.24.0' })),
    ).rejects.toThrow(/서명 검증 실패/);
    expect(existsSync(generationDir('frontend', '1.24.0'))).toBe(false);
  });

  test('서술자가 다른 버전을 가리키면 던진다 — 경로와 내용이 어긋난 것이다 ★', async () => {
    const h = build({ s3: fakeS3({ descriptor: { version: '9.9.9' } }) });

    await expect(
      h.fetcher.ensure(manifest({ frontend: '1.24.0' })),
    ).rejects.toThrow(/서술자 버전 불일치/);
  });

  test('404 면 던진다', async () => {
    const h = build();
    const missing = {
      ...h,
      fetcher: createArtifactFetcher({
        artifactRoot: root,
        baseRoot,
        baseUrl: BASE,
        hasGeneration: () => false,
        extract: () => undefined,
        verify: async () => true,
        fetch: (async () =>
          new Response('', { status: 404 })) as unknown as typeof fetch,
        onLog: () => undefined,
      }),
    };

    await expect(
      missing.fetcher.ensure(manifest({ frontend: '1.24.0' })),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('중간 상태를 남기지 않는다', () => {
  test('푸는 도중 실패하면 세대도 staging 도 남지 않는다 ★', async () => {
    const h = build({
      onExtract: () => {
        throw new Error('tar 실패');
      },
    });

    await expect(
      h.fetcher.ensure(manifest({ frontend: '1.24.0' })),
    ).rejects.toThrow(/tar 실패/);

    // 반쯤 받은 세대가 남으면 hasGeneration 이 참이 돼 그걸 실행한다.
    expect(existsSync(generationDir('frontend', '1.24.0'))).toBe(false);
    expect(readdirSync(path.join(root, 'frontend', '.generations'))).toEqual(
      [],
    );
  });
});

describe('앱 설치본 받기', () => {
  test('설치본 prefix 에서 받아 버전 디렉토리에 놓는다 ★', async () => {
    const h = build();

    const { baseInstaller } = await h.fetcher.ensure(baseManifest('1.24.0'));

    expect(h.s3.requested).toContain(
      `${BASE}/kiosk-electron/1.24.0/artifact.json`,
    );
    expect(baseInstaller).toBe(
      path.join(baseRoot, '1.24.0', 'Kiosk-Setup.exe'),
    );
    expect(existsSync(baseInstaller as string)).toBe(true);
  });

  test('설치본은 세대 디렉토리에 놓지 않는다 — 설치가 그곳을 지운다 ★', async () => {
    const h = build();

    await h.fetcher.ensure(baseManifest('1.24.0'));

    expect(readdirSync(root)).toEqual([]);
  });

  test('이미 받아둔 설치본은 다시 받지 않고 그 경로를 돌려준다', async () => {
    const h = build();
    const first = await h.fetcher.ensure(baseManifest('1.24.0'));
    const before = h.s3.requested.length;

    const again = await h.fetcher.ensure(baseManifest('1.24.0'));

    expect(again.baseInstaller).toBe(first.baseInstaller);
    expect(h.s3.requested.length).toBe(before);
  });

  test('서명이 맞지 않으면 설치본을 남기지 않는다 ★', async () => {
    const h = build({ verified: false });

    await expect(h.fetcher.ensure(baseManifest('1.24.0'))).rejects.toThrow(
      /서명 검증 실패: base/,
    );
    expect(readdirSync(baseRoot)).toEqual([]);
  });

  test('새 설치본을 받으면 옛 설치본은 치운다 — 버전당 256MB 다 ★', async () => {
    const h = build();
    await h.fetcher.ensure(baseManifest('1.23.0'));

    await h.fetcher.ensure(baseManifest('1.24.0'));

    expect(readdirSync(baseRoot)).toEqual(['1.24.0']);
  });

  test('돌고 있는 버전의 설치본은 치운다 — 설치가 반영된 순간 쓸모가 끝난다 ★', async () => {
    const h = build();
    await h.fetcher.ensure(baseManifest('1.24.0'));

    h.fetcher.sweepInstalled('1.24.0');

    expect(readdirSync(baseRoot)).toEqual([]);
  });

  test('아직 적용하지 않은 설치본은 남긴다 — 다시 온 지시에 256MB 를 또 받지 않는다 ★', async () => {
    const h = build();
    await h.fetcher.ensure(baseManifest('1.25.0'));

    h.fetcher.sweepInstalled('1.24.0');

    expect(readdirSync(baseRoot)).toEqual(['1.25.0']);
  });

  test('치울 것이 없으면 아무것도 하지 않는다', () => {
    const h = build();

    h.fetcher.sweepInstalled('1.24.0');

    expect(readdirSync(baseRoot)).toEqual([]);
  });

  test('치울 때 파일은 건드리지 않는다 — 같은 자리에 적용 기록이 놓인다 ★', async () => {
    const h = build();
    writeFileSync(path.join(baseRoot, 'last-apply.json'), '{}');

    await h.fetcher.ensure(baseManifest('1.24.0'));

    expect(readdirSync(baseRoot).sort()).toEqual(['1.24.0', 'last-apply.json']);
  });

  test('컴포넌트 매니페스트는 설치본을 돌려주지 않는다', async () => {
    const h = build();

    const { baseInstaller } = await h.fetcher.ensure(
      manifest({ frontend: '1.24.0' }),
    );

    expect(baseInstaller).toBeNull();
  });
});
