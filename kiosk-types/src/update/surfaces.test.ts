import { describe, expect, test } from 'bun:test';
import { artifactSurfacesFor, matchesBackendSurfaces } from './surfaces';

/**
 * 표면 판정 박제.
 *
 * 이 규칙의 존재 이유는 하나다 — **무관한 계약 변경이 발목을 잡지 않게** 하면서, 말이
 * 오가는 표면이 어긋난 것은 반드시 잡는 것. 콘솔의 조합 제안과 키오스크 witness 가 같은
 * 규칙을 봐야 하므로 여기서 고정한다.
 */

const CONTRACT = {
  frontendBackend: 'FB',
  processes: { 'token-dispenser': 'CASH', ime: 'SUP' },
};

describe('산출물이 실어야 하는 표면', () => {
  test('프론트는 합성 하나, 장치는 자기 것 하나, 백엔드는 전부 ★', () => {
    expect(artifactSurfacesFor('frontend', CONTRACT)).toEqual({
      frontendBackend: 'FB',
    });
    expect(artifactSurfacesFor('token-dispenser', CONTRACT)).toEqual({
      processes: { 'token-dispenser': 'CASH' },
    });
    expect(artifactSurfacesFor('backend', CONTRACT)).toEqual({
      frontendBackend: 'FB',
      processes: { 'token-dispenser': 'CASH', ime: 'SUP' },
    });
  });
});

describe('기준 백엔드와의 일치 판정', () => {
  const backend = artifactSurfacesFor('backend', CONTRACT);

  test('장치는 자기 표면만 본다 — 다른 표면이 움직여도 무관하다 ★', () => {
    // 장치 스키마만 바뀐 계약: FB 는 그대로, token-dispenser 만 움직였다.
    const shifted = artifactSurfacesFor('backend', {
      frontendBackend: 'FB',
      processes: { 'token-dispenser': 'CASH2', ime: 'SUP' },
    });
    // 프론트는 무관한 변경이라 여전히 배포 가능해야 한다 — total 대조였다면 막혔다.
    expect(
      matchesBackendSurfaces(
        'frontend',
        artifactSurfacesFor('frontend', CONTRACT),
        shifted,
      ),
    ).toBe(true);
    // ime 도 무관하다.
    expect(
      matchesBackendSurfaces(
        'ime',
        artifactSurfacesFor('ime', CONTRACT),
        shifted,
      ),
    ).toBe(true);
    // 움직인 표면의 당사자만 어긋난다.
    expect(
      matchesBackendSurfaces(
        'token-dispenser',
        artifactSurfacesFor('token-dispenser', CONTRACT),
        shifted,
      ),
    ).toBe(false);
  });

  test('프론트는 합성 지문으로 판정한다', () => {
    expect(
      matchesBackendSurfaces('frontend', { frontendBackend: 'FB' }, backend),
    ).toBe(true);
    expect(
      matchesBackendSurfaces('frontend', { frontendBackend: 'OTHER' }, backend),
    ).toBe(false);
  });

  test('표면을 모르는 옛 산출물은 불일치가 아니라 판정 불가다 ★', () => {
    // 옛 산출물을 위험 판정하면 오탐 되감기가 되고, 안전 판정하면 사고를 승인한다.
    // 둘 다 아니어야 한다 — 콘솔은 "배포 가능하지 않음", 키오스크는 백스톱 위임.
    expect(matchesBackendSurfaces('frontend', undefined, backend)).toBe(
      undefined,
    );
    expect(matchesBackendSurfaces('frontend', {}, backend)).toBe(undefined);
    expect(
      matchesBackendSurfaces('token-dispenser', { processes: {} }, backend),
    ).toBe(undefined);
    expect(
      matchesBackendSurfaces(
        'token-dispenser',
        artifactSurfacesFor('token-dispenser', CONTRACT),
        undefined,
      ),
    ).toBe(undefined);
  });

  test('백엔드는 기준 그 자체다', () => {
    expect(matchesBackendSurfaces('backend', undefined, undefined)).toBe(true);
  });
});
