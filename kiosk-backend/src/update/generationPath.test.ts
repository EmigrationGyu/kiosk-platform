import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BASELINE_VERSION_FILE,
  componentSegments,
  type UpdateComponent,
} from 'kiosk-types';
import { readBaselineVersions } from './generationPath';

let root = '';

const makeRoot = (): string => {
  root = mkdtempSync(path.join(tmpdir(), 'baseline-'));
  return root;
};

/** 동봉본은 컴포넌트 디렉토리 바로 아래에 있다(세대는 `.generations/` 안). */
const writeManifest = (component: UpdateComponent, body: string) => {
  const dir = path.join(root, ...componentSegments(component));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, BASELINE_VERSION_FILE), body);
};

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('readBaselineVersions', () => {
  test('동봉본의 실제 버전을 읽는다', () => {
    makeRoot();
    writeManifest('backend', JSON.stringify({ version: '0.29.0' }));
    writeManifest('token-dispenser', JSON.stringify({ version: '0.28.0-3' }));

    const versions = readBaselineVersions(root, ['backend', 'token-dispenser']);
    expect(versions).toEqual({
      backend: '0.29.0',
      'token-dispenser': '0.28.0-3',
    });
  });

  test('serialport 는 한 단계 아래에 있다 — 경로 규약을 따른다', () => {
    makeRoot();
    writeManifest('token-dispenser', JSON.stringify({ version: '0.28.0' }));
    expect(readBaselineVersions(root, ['token-dispenser'])).toEqual({
      'token-dispenser': '0.28.0',
    });
  });

  test('파일이 없으면 그 컴포넌트만 빠진다 ★', () => {
    makeRoot();
    writeManifest('backend', JSON.stringify({ version: '0.29.0' }));

    // frontend 는 안 썼다 — 옛 설치본처럼 version.json 이 없는 경우.
    expect(readBaselineVersions(root, ['backend', 'frontend'])).toEqual({
      backend: '0.29.0',
    });
  });

  test('깨진 JSON 도 그 컴포넌트만 빠진다 — 보고 전체를 막지 않는다 ★', () => {
    makeRoot();
    writeManifest('backend', '{ not json');
    writeManifest('frontend', JSON.stringify({ version: '0.29.0' }));

    expect(readBaselineVersions(root, ['backend', 'frontend'])).toEqual({
      frontend: '0.29.0',
    });
  });

  test('version 이 없거나 문자열이 아니면 뺀다 — 지어내지 않는다', () => {
    makeRoot();
    writeManifest('backend', JSON.stringify({ name: 'x' }));
    writeManifest('frontend', JSON.stringify({ version: 3 }));

    expect(readBaselineVersions(root, ['backend', 'frontend'])).toEqual({});
  });

  test('루트가 통째로 없으면 빈 맵 — 던지지 않는다', () => {
    expect(
      readBaselineVersions(path.join(tmpdir(), 'no-such-root'), ['backend']),
    ).toEqual({});
  });
});
