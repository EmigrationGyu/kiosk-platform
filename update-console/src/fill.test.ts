import { describe, expect, test } from 'bun:test';
import { fillLatest } from './fill';
import type {
  ArtifactDescriptor,
  ArtifactSurfaces,
  UpdateComponent,
} from './types';
import { matchesBackendSurfaces } from './types';

const make = (
  version: string,
  surfaces: ArtifactSurfaces,
  bakedAt: string,
): ArtifactDescriptor => ({
  descriptorVersion: 1,
  version,
  contractTotal: `total-${version}`,
  surfaces,
  bakedAt,
  url: 'https://x/a.tar.gz',
  sha256: 'a'.repeat(64),
  sigUrl: 'https://x/a.sig',
});

/** 컴포넌트마다 여러 버전을 가진 가짜 저장소 — s3 의 표면 필터와 같은 규칙으로 거른다. */
const loaderOf =
  (store: Record<string, ArtifactDescriptor[]>) =>
  async (component: UpdateComponent, reference?: ArtifactSurfaces) =>
    (store[component] ?? [])
      .filter(
        (d) =>
          reference === undefined ||
          matchesBackendSurfaces(component, d.surfaces, reference) === true,
      )
      .sort((a, b) => (b.bakedAt ?? '').localeCompare(a.bakedAt ?? ''))[0];

const COMPONENTS = [
  'backend',
  'frontend',
  'token-dispenser',
] as UpdateComponent[];

/** 표면 조합 축약. */
const backendSurfaces = (fb: string, td: string): ArtifactSurfaces => ({
  frontendBackend: fb,
  processes: { 'token-dispenser': td },
});

describe('최신으로 채우기 — 기준은 백엔드다', () => {
  test('고른 백엔드가 기준이 된다 - 사용자의 선택을 존중한다 ★', async () => {
    const store = {
      backend: [
        make('1.0.0', backendSurfaces('FB1', 'TD1'), '2026-01-01T00:00:00Z'),
        make('2.0.0', backendSurfaces('FB2', 'TD1'), '2026-06-01T00:00:00Z'),
      ],
      frontend: [
        make('2.0.0', { frontendBackend: 'FB1' }, '2026-01-01T00:00:00Z'),
        make('3.0.0', { frontendBackend: 'FB2' }, '2026-06-01T00:00:00Z'),
      ],
      'token-dispenser': [
        make(
          '1.0.0',
          { processes: { 'token-dispenser': 'TD1' } },
          '2026-01-01T00:00:00Z',
        ),
      ],
    };

    const result = await fillLatest({
      components: COMPONENTS,
      // 사용자가 옛 백엔드를 골랐다 - 최신이 아니라 이것이 기준이어야 한다.
      picks: { backend: store.backend[0] as ArtifactDescriptor },
      load: loaderOf(store),
    });

    expect(result.baseline?.version).toBe('1.0.0');
    expect(result.picks.frontend?.version).toBe('2.0.0');
    expect(result.missing).toEqual([]);
  });

  test('표면이 맞으면 옛 세대도 조합에 남는다 - 무관한 변경이 발목을 안 잡는다 ★', async () => {
    // 새 백엔드는 token-dispenser 스키마만 움직였다(FB1 그대로, TD2). 프론트는 옛 것이
    // 그대로 말이 통해야 한다 — total 대조였다면 프론트도 새로 구워야 했다.
    const store = {
      backend: [
        make('2.0.0', backendSurfaces('FB1', 'TD2'), '2026-06-01T00:00:00Z'),
      ],
      frontend: [
        make('2.0.0', { frontendBackend: 'FB1' }, '2026-01-01T00:00:00Z'),
      ],
      'token-dispenser': [
        make(
          '1.0.0',
          { processes: { 'token-dispenser': 'TD1' } },
          '2026-01-01T00:00:00Z',
        ),
        make(
          '2.0.0',
          { processes: { 'token-dispenser': 'TD2' } },
          '2026-06-01T00:00:00Z',
        ),
      ],
    };

    const result = await fillLatest({
      components: COMPONENTS,
      picks: {},
      load: loaderOf(store),
    });

    expect(result.baseline?.version).toBe('2.0.0');
    // 프론트는 옛 세대 그대로 통과 — 이것이 표면 판정의 존재 이유다.
    expect(result.picks.frontend?.version).toBe('2.0.0');
    // 움직인 표면의 당사자만 새 것을 요구받는다.
    expect(result.picks['token-dispenser']?.version).toBe('2.0.0');
    expect(result.missing).toEqual([]);
  });

  test('맞는 버전이 없으면 채우지 않고 알린다 - 아무거나 채우면 말이 안 통한다 ★', async () => {
    const store = {
      backend: [
        make('2.0.0', backendSurfaces('FB2', 'TD1'), '2026-06-01T00:00:00Z'),
      ],
      // 프론트는 옛 표면뿐이다 — 아직 못 따라왔다.
      frontend: [
        make('2.0.0', { frontendBackend: 'FB1' }, '2026-01-01T00:00:00Z'),
      ],
      'token-dispenser': [
        make(
          '1.0.0',
          { processes: { 'token-dispenser': 'TD1' } },
          '2026-01-01T00:00:00Z',
        ),
      ],
    };

    const result = await fillLatest({
      components: COMPONENTS,
      picks: {},
      load: loaderOf(store),
    });

    expect(result.picks.frontend).toBeUndefined();
    expect(result.missing).toEqual(['frontend']);
    expect(result.picks['token-dispenser']?.version).toBe('1.0.0');
  });

  test('표면을 모르는 옛 산출물은 채우지 않는다 — 몰라서 못 고르는 것이다', async () => {
    const store = {
      backend: [
        make('2.0.0', backendSurfaces('FB1', 'TD1'), '2026-06-01T00:00:00Z'),
      ],
      frontend: [
        { ...make('1.9.0', {}, '2026-05-01T00:00:00Z'), surfaces: undefined },
      ],
      'token-dispenser': [
        make(
          '1.0.0',
          { processes: { 'token-dispenser': 'TD1' } },
          '2026-01-01T00:00:00Z',
        ),
      ],
    };

    const result = await fillLatest({
      components: COMPONENTS,
      picks: {},
      load: loaderOf(store),
    });

    expect(result.missing).toEqual(['frontend']);
  });

  test('백엔드가 아예 없으면 기준이 없다 - 전부 미충족', async () => {
    const result = await fillLatest({
      components: COMPONENTS,
      picks: {},
      load: async () => undefined,
    });

    expect(result.baseline).toBeUndefined();
    expect(result.missing).toEqual(COMPONENTS);
  });
});
