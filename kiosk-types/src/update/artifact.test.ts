import { describe, expect, test } from 'bun:test';
import { ArtifactDescriptorSchema, artifactVersionUrl } from './artifact';
import { artifactPrefix, UPDATE_COMPONENT } from './components';
import { UPDATABLE_COMPONENTS } from './generation';

const BASE = 'https://kiosk-artifacts-example.s3.ap-northeast-2.amazonaws.com';

describe('산출물 prefix', () => {
  test('CI 가 쓰는 이름과 같다 — package.json name 이 곧 prefix 다', () => {
    expect(artifactPrefix(UPDATE_COMPONENT.BACKEND)).toBe('kiosk-backend');
    // 프론트는 `-v3` 접미어가 붙는다 — 규칙이 아니라 실제 package.json name 이 출처다.
    expect(artifactPrefix(UPDATE_COMPONENT.FRONTEND)).toBe('kiosk-frontend');
    // serialport 패키지는 package.json name 이 프로세스 식별자와 같다.
    expect(artifactPrefix('token-dispenser')).toBe('token-dispenser');
    expect(artifactPrefix('ime')).toBe('ime');
  });

  test('모든 컴포넌트가 비어 있지 않은 prefix 를 가진다 ★', () => {
    // 새 장치가 늘어도 저절로 따라와야 한다 — 목록을 다시 적으면 조용히 빠진다.
    for (const component of UPDATABLE_COMPONENTS) {
      expect(artifactPrefix(component).length).toBeGreaterThan(0);
    }
  });
});

describe('버전 URL', () => {
  test('base + prefix + version 으로 조립한다', () => {
    expect(artifactVersionUrl(BASE, UPDATE_COMPONENT.FRONTEND, '1.24.0')).toBe(
      `${BASE}/kiosk-frontend/1.24.0`,
    );
  });

  test('base 끝의 슬래시는 겹치지 않는다', () => {
    expect(artifactVersionUrl(`${BASE}/`, 'token-dispenser', '0.3.1')).toBe(
      `${BASE}/token-dispenser/0.3.1`,
    );
  });
});

describe('서술자 스키마', () => {
  const valid = {
    descriptorVersion: 1 as const,
    version: '1.24.0',
    url: `${BASE}/kiosk-frontend/1.24.0/dist.tar.gz`,
    sha256: 'a'.repeat(64),
    sigUrl: `${BASE}/kiosk-frontend/1.24.0/dist.tar.gz.sig`,
  };

  test('정상 서술자를 받아들인다', () => {
    expect(ArtifactDescriptorSchema.parse(valid)).toEqual(valid);
  });

  test('sha256 형식이 아니면 거부한다 — 검증의 근거가 되는 값이다 ★', () => {
    expect(
      ArtifactDescriptorSchema.safeParse({ ...valid, sha256: 'deadbeef' })
        .success,
    ).toBe(false);
    expect(
      ArtifactDescriptorSchema.safeParse({ ...valid, sha256: 'A'.repeat(64) })
        .success,
    ).toBe(false);
  });

  test('뒤늦게 추가된 필드가 없어도 받아들인다 - 옛 산출물이 거부되면 안 된다', () => {
    expect(ArtifactDescriptorSchema.parse(valid).contractTotal).toBeUndefined();
  });

  test('새 필드를 실으면 그대로 통과한다', () => {
    const rich = {
      ...valid,
      component: 'token-dispenser',
      contractTotal: 'dae8a8af6760fcef94ab0ed069cb2737',
      bakedAt: '2026-08-26T06:02:13.558Z',
      description: '현금 방출 재시도 보강',
    };

    expect(ArtifactDescriptorSchema.parse(rich)).toEqual(rich);
  });

  test('descriptorVersion 은 1 로 둔다 - 올리면 배포된 키오스크가 거부한다', () => {
    // 스키마가 literal(1) 이라 옛 키오스크는 2를 파싱하지 못한다.
    expect(
      ArtifactDescriptorSchema.safeParse({ ...valid, descriptorVersion: 2 })
        .success,
    ).toBe(false);
  });

  test('URL 이 아니면 거부한다', () => {
    expect(
      ArtifactDescriptorSchema.safeParse({ ...valid, url: 'dist.tar.gz' })
        .success,
    ).toBe(false);
  });
});
