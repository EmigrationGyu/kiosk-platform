import { describe, expect, test } from 'bun:test';
import { manifestBody } from './manifest';
import type { ArtifactDescriptor } from './types';
import { BASE_TARGET } from './types';

const descriptor = (version: string): ArtifactDescriptor => ({
  descriptorVersion: 1,
  version,
  url: `https://bucket/x/${version}/dist.tar.gz`,
  sha256: 'a'.repeat(64),
  sigUrl: `https://bucket/x/${version}/dist.tar.gz.sig`,
});

describe('보낼 매니페스트', () => {
  test('컴포넌트 모드는 고른 컴포넌트만 싣는다', () => {
    const body = manifestBody('components', {
      frontend: descriptor('1.24.0'),
      'token-dispenser': descriptor('0.3.1'),
    });

    expect(body).toEqual({
      components: { frontend: '1.24.0', 'token-dispenser': '0.3.1' },
    });
  });

  test('앱 전체 모드는 버전 하나만 싣는다', () => {
    const body = manifestBody('base', { [BASE_TARGET]: descriptor('1.24.0') });

    expect(body).toEqual({ base: '1.24.0' });
  });

  test('두 축은 섞이지 않는다 — 섞이면 키오스크가 거절한다 ★', () => {
    const both = {
      frontend: descriptor('1.24.0'),
      [BASE_TARGET]: descriptor('1.9.0'),
    };

    expect(manifestBody('components', both)).toEqual({
      components: { frontend: '1.24.0' },
    });
    expect(manifestBody('base', both)).toEqual({ base: '1.9.0' });
  });

  test('고른 것이 없으면 보낼 것이 없다', () => {
    expect(manifestBody('components', {})).toBeNull();
    expect(manifestBody('base', {})).toBeNull();
    expect(manifestBody('base', { frontend: descriptor('1.24.0') })).toBeNull();
  });
});
