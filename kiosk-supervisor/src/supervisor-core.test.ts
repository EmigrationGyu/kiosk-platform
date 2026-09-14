/**
 * checkForUpdate 결정 로직 단위 테스트.
 *
 * F2 회귀 방지: `.version` 만 보고 "최신"이라 판단하던 갭을 박제한다 —
 * 버전이 같아도 자식 파일이 사라졌으면 재페치(manifest 반환)해야 한다.
 *
 * fetch 만 목킹하고 임시 디렉토리로 childPath/.version/.neg.json 만 세팅한다.
 * checkForUpdate 는 서명/다운로드를 안 타므로 S3·서명·네트워크가 전혀 필요 없다.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, makeCtx } from './supervisor-core';

const MANIFEST = {
  version: '1.0.0',
  url: 'https://mock/loader/1.0.0/loader.js',
  sigUrl: 'https://mock/loader/1.0.0/loader.js.sig',
  sha256: 'deadbeef',
  minLoaderVersion: '0.0.0',
  publishedAt: '2026-06-01T00:00:00.000Z',
};

let dir = '';
let childPath = '';
const originalFetch = globalThis.fetch;

/** 모든 fetch 가 MANIFEST 를 200 으로 돌려주도록 목킹. */
function mockManifestFetch(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(MANIFEST), {
      status: 200,
    })) as unknown as typeof fetch;
}

const ctx = () =>
  makeCtx({
    label: 'test',
    manifestUrl: 'https://mock/loader/latest.json',
    childPath,
    enableUpdate: true,
  });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sup-core-'));
  childPath = join(dir, 'loader.js');
  mockManifestFetch();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
});

test('최신 버전 + 자식 파일 존재 → null (재페치 안 함)', async () => {
  await Bun.write(`${childPath}.version`, MANIFEST.version);
  await Bun.write(childPath, '// loader bytes');

  expect(await checkForUpdate(ctx())).toBeNull();
});

test('F2: 최신 버전 + 자식 파일 없음 → manifest 반환 (재페치)', async () => {
  await Bun.write(`${childPath}.version`, MANIFEST.version);
  // childPath 는 일부러 만들지 않음 — 사라진 loader.js 시나리오.

  const result = await checkForUpdate(ctx());
  expect(result?.version).toBe(MANIFEST.version);
});

test('버전 불일치 → manifest 반환 (정상 업데이트)', async () => {
  await Bun.write(`${childPath}.version`, '0.9.0');
  await Bun.write(childPath, '// old loader bytes');

  const result = await checkForUpdate(ctx());
  expect(result?.version).toBe(MANIFEST.version);
});

test('버전 불일치 + negative-cache 적중 → null (롤백된 버전 재시도 금지)', async () => {
  await Bun.write(`${childPath}.version`, '0.9.0');
  await Bun.write(childPath, '// old loader bytes');
  await Bun.write(
    `${childPath}.neg.json`,
    JSON.stringify([
      {
        version: MANIFEST.version,
        failedAt: MANIFEST.publishedAt,
        reason: 'wedged',
      },
    ]),
  );

  expect(await checkForUpdate(ctx())).toBeNull();
});
