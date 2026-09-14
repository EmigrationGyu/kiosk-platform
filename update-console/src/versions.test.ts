import { describe, expect, test } from 'bun:test';
import type { ArtifactDescriptor } from './types';
import {
  channelOf,
  newestFirst,
  passesChannel,
  passesSurfaces,
} from './versions';

const descriptor = (over: Partial<ArtifactDescriptor>): ArtifactDescriptor => ({
  descriptorVersion: 1,
  version: '0.24.0',
  url: 'https://x/a.tar.gz',
  sha256: 'a'.repeat(64),
  sigUrl: 'https://x/a.sig',
  ...over,
});

describe('채널', () => {
  test('접미어가 곧 표식이다 - master 는 X.Y.Z, develop 은 X.Y.Z-N', () => {
    expect(channelOf('0.24.0')).toBe('release');
    expect(channelOf('0.24.0-4')).toBe('development');
  });

  test('개발 서버는 전부, 그 외는 릴리스만 ★', () => {
    expect(passesChannel('0.24.0-4', 'development')).toBe(true);
    expect(passesChannel('0.24.0', 'development')).toBe(true);

    // staging 에 develop 브랜치 코드를 올리면 안 된다.
    expect(passesChannel('0.24.0-4', 'staging')).toBe(false);
    expect(passesChannel('0.24.0', 'staging')).toBe(true);
  });
});

describe('표면', () => {
  const reference = {
    frontendBackend: 'FB',
    processes: { 'token-dispenser': 'TD' },
  };

  test('지문이 없으면 숨긴다 - 섞인 조합을 만들 수 있다 ★', () => {
    expect(passesSurfaces(descriptor({}), 'frontend')).toBe(false);
    expect(
      passesSurfaces(descriptor({ contractTotal: 'abc' }), 'frontend'),
    ).toBe(true);
  });

  test('기준 백엔드가 있으면 자기 표면이 맞는 것만 통과한다 ★', () => {
    const it = descriptor({
      contractTotal: 'abc',
      surfaces: { frontendBackend: 'FB' },
    });

    expect(passesSurfaces(it, 'frontend', reference)).toBe(true);
    expect(passesSurfaces(it, 'frontend', { frontendBackend: 'OTHER' })).toBe(
      false,
    );
  });

  test('total 이 달라도 표면이 맞으면 통과한다 - 무관한 변경이 발목을 안 잡는다 ★', () => {
    const it = descriptor({
      contractTotal: '다른-총합',
      surfaces: { processes: { 'token-dispenser': 'TD' } },
    });

    expect(passesSurfaces(it, 'token-dispenser', reference)).toBe(true);
  });

  test('표면을 모르는 옛 산출물은 기준이 있으면 숨긴다', () => {
    const it = descriptor({ contractTotal: 'abc' });

    expect(passesSurfaces(it, 'token-dispenser', reference)).toBe(false);
  });

  test('백엔드 자신과 앱 전체는 기준으로 거르지 않는다', () => {
    const it = descriptor({ contractTotal: 'abc' });

    expect(passesSurfaces(it, 'backend', reference)).toBe(true);
    expect(passesSurfaces(it, 'base', reference)).toBe(true);
  });
});

describe('정렬', () => {
  test('bakedAt 이 진짜 순서다 - 버전 문자열은 채널이 섞이면 뒤집힌다 ★', () => {
    // 0.24.0(master) 다음에 0.24.0-1(develop) 이 나온다. semver 는 반대로 본다.
    const release = descriptor({
      version: '0.24.0',
      bakedAt: '2026-08-20T00:00:00.000Z',
    });
    const later = descriptor({
      version: '0.24.0-1',
      bakedAt: '2026-08-26T00:00:00.000Z',
    });

    expect([release, later].sort(newestFirst)[0]?.version).toBe('0.24.0-1');
  });

  test('bakedAt 이 없으면 뒤로 밀린다', () => {
    const known = descriptor({
      version: 'a',
      bakedAt: '2026-01-01T00:00:00.000Z',
    });
    const unknown = descriptor({ version: 'b' });

    expect([unknown, known].sort(newestFirst)[0]?.version).toBe('a');
  });
});
