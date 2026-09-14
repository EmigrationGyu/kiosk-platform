import { describe, expect, test } from 'bun:test';
import { SERIALPORT_PROCESS } from '../serialport/processes';
import { UPDATE_COMPONENT } from './components';
import {
  ApplyInstructionSchema,
  BASELINE_GENERATION,
  diffPointers,
  GENERATIONS_DIR,
  generationSegments,
  INITIAL_POINTER,
  ManifestSchema,
  PointerSchema,
  pointerFromManifest,
  resolveGeneration,
} from './generation';
import { isUpdatePending, updatePendingCause } from './pending';

describe('세대 경로', () => {
  test('컴포넌트 디렉토리 **안**에 둔다 — 세대들이 네이티브 모듈을 공유해야 한다', () => {
    const segments = generationSegments(
      SERIALPORT_PROCESS.TOKEN_DISPENSER,
      '1.0.0',
    );
    // …/serialport/token-dispenser/.generations/1.0.0 → 위로 올라가면 …/token-dispenser/node_modules 를 만난다.
    expect(segments.slice(0, 2)).toEqual(['serialport', 'token-dispenser']);
    expect(segments[2]).toBe(GENERATIONS_DIR);
  });

  test('컴포넌트 종류에 따라 레이아웃이 갈린다', () => {
    expect(generationSegments(UPDATE_COMPONENT.BACKEND, '1.2.3')).toEqual([
      'backend',
      GENERATIONS_DIR,
      '1.2.3',
    ]);
    expect(
      generationSegments(SERIALPORT_PROCESS.TOKEN_DISPENSER, '0.9.1'),
    ).toEqual(['serialport', 'token-dispenser', GENERATIONS_DIR, '0.9.1']);
  });

  test('세대 이름이 마지막 세그먼트다 — 적재 경로만 보고 세대를 읽을 수 있어야 한다', () => {
    const segments = generationSegments(UPDATE_COMPONENT.FRONTEND, '4.5.6');
    expect(segments.at(-1)).toBe('4.5.6');
  });
});

describe('포인터 해석', () => {
  test('명시된 컴포넌트는 그 세대로', () => {
    const pointer = PointerSchema.parse({
      pointerVersion: 1,
      components: { backend: '1.2.3' },
    });
    expect(resolveGeneration(pointer, UPDATE_COMPONENT.BACKEND)).toBe('1.2.3');
  });

  test('명시되지 않은 컴포넌트는 baseline — 옛 포인터가 새 컴포넌트를 만나도 유효하다', () => {
    const pointer = PointerSchema.parse({
      pointerVersion: 1,
      components: { backend: '1.2.3' },
    });
    expect(resolveGeneration(pointer, UPDATE_COMPONENT.FRONTEND)).toBe(
      BASELINE_GENERATION,
    );
    expect(resolveGeneration(pointer, SERIALPORT_PROCESS.IME)).toBe(
      BASELINE_GENERATION,
    );
  });

  test('빈 포인터는 전부 baseline', () => {
    expect(resolveGeneration(INITIAL_POINTER, UPDATE_COMPONENT.BACKEND)).toBe(
      BASELINE_GENERATION,
    );
  });
});

describe('포인터 검증', () => {
  test('알 수 없는 컴포넌트는 거부한다', () => {
    expect(
      PointerSchema.safeParse({
        pointerVersion: 1,
        components: { nope: '1.0.0' },
      }).success,
    ).toBe(false);
  });

  test('빈 세대 이름은 거부한다 — 경로가 부모 디렉토리로 무너진다', () => {
    expect(
      PointerSchema.safeParse({
        pointerVersion: 1,
        components: { backend: '' },
      }).success,
    ).toBe(false);
  });

  test('형식 버전이 없거나 다르면 거부한다', () => {
    expect(
      PointerSchema.safeParse({ components: { backend: '1.0.0' } }).success,
    ).toBe(false);
    expect(
      PointerSchema.safeParse({
        pointerVersion: 2,
        components: {},
      }).success,
    ).toBe(false);
  });
});

const emptyPointer = { pointerVersion: 1, components: {} } as const;

describe('매니페스트', () => {
  test('현재 포인터에 덮어쓴다', () => {
    const manifest = ManifestSchema.parse({
      manifestVersion: 1,
      components: { backend: '1.2.3' },
    });

    expect(pointerFromManifest(manifest, emptyPointer)).toEqual({
      pointerVersion: 1,
      components: { backend: '1.2.3' },
    });
  });

  test('빠진 컴포넌트는 그대로 둔다 — 조용히 되돌아가면 실행 중인 것과 어긋난다', () => {
    const current = {
      pointerVersion: 1,
      components: { frontend: 'f2', backend: '1.0.0' },
    } as const;
    const manifest = ManifestSchema.parse({
      manifestVersion: 1,
      components: { 'token-dispenser': 'c2' },
    });

    expect(pointerFromManifest(manifest, current).components).toEqual({
      frontend: 'f2',
      backend: '1.0.0',
      'token-dispenser': 'c2',
    });
  });

  test('base 는 components 와 함께 보낼 수 없다 - 설치가 세대를 전부 새로 놓는다 ★', () => {
    expect(
      ManifestSchema.safeParse({ manifestVersion: 1, base: '1.9.0' }).success,
    ).toBe(true);
    expect(
      ManifestSchema.safeParse({
        manifestVersion: 1,
        components: { backend: '1.2.3' },
        base: '1.9.0',
      }).success,
    ).toBe(false);
  });

  test('components 는 생략하면 빈 조합이다', () => {
    const parsed = ManifestSchema.parse({ manifestVersion: 1 });

    expect(parsed.components).toEqual({});
  });

  test('되돌리려면 baseline 을 명시한다', () => {
    const current = {
      pointerVersion: 1,
      components: { backend: '1.2.3' },
    } as const;
    const rollback = ManifestSchema.parse({
      manifestVersion: 1,
      components: { backend: BASELINE_GENERATION },
    });

    expect(
      resolveGeneration(pointerFromManifest(rollback, current), 'backend'),
    ).toBe(BASELINE_GENERATION);
  });

  test('알 수 없는 컴포넌트를 지시하면 거부한다', () => {
    expect(
      ManifestSchema.safeParse({
        manifestVersion: 1,
        components: { nope: '1.0.0' },
      }).success,
    ).toBe(false);
  });
});

describe('적용 지시', () => {
  test('설치본 경로를 모르는 세대가 보낸 지시도 파싱된다 ★', () => {
    // 이 필드를 모르는 백엔드로 되감긴 상태에서도 지시가 도착해야 한다 —
    // 파싱이 막히면 되감은 조합에서 다음 지시를 영영 못 받는다.
    const parsed = ApplyInstructionSchema.parse({
      commandId: null,
      manifest: { manifestVersion: 1, components: { frontend: 'f5' } },
    });

    expect(parsed.baseInstaller).toBeNull();
  });

  test('설치본 경로를 실어 보낼 수 있다', () => {
    const parsed = ApplyInstructionSchema.parse({
      commandId: 'c1',
      manifest: { manifestVersion: 1, base: '1.24.0' },
      baseInstaller: String.raw`C:\Users\me\Kiosk\update\1.24.0\Setup.exe`,
    });

    expect(parsed.manifest.base).toBe('1.24.0');
    expect(parsed.baseInstaller).toContain('Setup.exe');
  });
});

describe('업데이트 대기 사유', () => {
  test('접두어로 식별된다', () => {
    expect(isUpdatePending(updatePendingCause('교체 준비 중'))).toBe(true);
  });

  test('다른 실패와 섞이지 않는다 — 안전한 재시도와 위험한 재시도를 가르는 근거다', () => {
    expect(isUpdatePending('backend port replaced')).toBe(false);
    expect(isUpdatePending('CONTRACT_MISMATCH: …')).toBe(false);
    expect(isUpdatePending(undefined)).toBe(false);
  });
});

describe('조합 비교', () => {
  const p = (components: Record<string, string>) =>
    PointerSchema.parse({ pointerVersion: 1, components });

  test('같은 조합이면 아무것도 안 나온다', () => {
    expect(diffPointers(p({ backend: '1.0' }), p({ backend: '1.0' }))).toEqual(
      [],
    );
  });

  test('올라가는 것도 내려가는 것도 차이다', () => {
    expect(diffPointers(p({}), p({ backend: '1.0' }))).toEqual(['backend']);
    expect(diffPointers(p({ backend: '1.0' }), p({}))).toEqual(['backend']);
  });

  test('되감기: 목적지에 없는 컴포넌트도 baseline 으로 되돌아간다', () => {
    const current = p({ backend: '2.0', frontend: 'f2' });
    const stable = p({ backend: '1.0' });

    // frontend 가 stable 에 없다 = baseline 이어야 한다는 뜻이다. 빠뜨리면 포인터가
    // 실행 중인 것과 어긋난다.
    expect(diffPointers(current, stable)).toEqual(['backend', 'frontend']);
  });

  test('적용: 덮어쓴 target 을 주면 지명된 것만 나온다', () => {
    const current = p({ backend: '1.0', frontend: 'f2' });
    const target = pointerFromManifest(
      ManifestSchema.parse({
        manifestVersion: 1,
        components: { 'token-dispenser': 'c2' },
      }),
      current,
    );

    expect(diffPointers(current, target)).toEqual(['token-dispenser']);
  });

  test('이미 목적지와 같은 컴포넌트는 건드리지 않는다', () => {
    const current = p({ backend: '1.0', frontend: 'f2' });
    const stable = p({ backend: '1.0' });

    expect(diffPointers(current, stable)).toEqual(['frontend']);
  });
});
