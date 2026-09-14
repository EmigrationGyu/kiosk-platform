import { describe, expect, test } from 'bun:test';
import type { Manifest, Pointer } from 'kiosk-types/src/update/generation';
import { createApplyEngine } from './applyEngine';
import type { GenerationStore } from './generationStore';

const manifest = (components: Manifest['components']): Manifest => ({
  manifestVersion: 1,
  components,
});

/** 디스크 대신 메모리에 사는 저장소 — 판단만 검증한다. */
function fakeStore(options?: {
  live?: Pointer['components'];
  stable?: Pointer['components'];
  present?: string[];
}) {
  const files: Record<string, Pointer> = {
    'live.json': { pointerVersion: 1, components: options?.live ?? {} },
    'last-stable.json': {
      pointerVersion: 1,
      components: options?.stable ?? {},
    },
  };
  const present = new Set(options?.present ?? []);
  // backend 세대 이름만 뽑아둔다 — 정리 규칙 검증용.
  const generations = new Set(
    [...present]
      .filter((p) => p.startsWith('backend@'))
      .map((p) => p.split('@')[1]),
  );

  const store: GenerationStore = {
    ensureBaselines: () => undefined,
    resolveDir: () => '',
    readPointer: () => files['live.json'],
    readStable: () => files['last-stable.json'],
    hasGeneration: (component, generation) =>
      generation === 'baseline' || present.has(`${component}@${generation}`),
    writePointer: (pointer) => {
      files['live.json'] = pointer;
    },
    promoteLiveToStable: () => {
      files['last-stable.json'] = files['live.json'];
    },
    pruneGenerations: () => {
      // 참조되지 않는 세대를 지운다 — 실제 저장소와 같은 규칙(live·stable·baseline 유지).
      const keep = new Set([
        'baseline',
        files['live.json'].components.backend,
        files['last-stable.json'].components.backend,
      ]);
      const removed = [...generations].filter((g) => !keep.has(g));
      for (const g of removed) generations.delete(g);
      return removed.map((g) => `backend@${g}`);
    },
  };
  return { store, files, generations };
}

function harness(options?: Parameters<typeof fakeStore>[0]) {
  const { store, files, generations } = fakeStore(options);
  const restarted: string[] = [];
  const logs: string[] = [];
  // 렌더러 효과가 **불린 시점에** 포인터가 뭐라고 하는지. 실제 구현은 이때 경로를 다시
  // 해석하므로, 여기 남는 값이 곧 화면에 뜨는 세대다.
  const rendererSaw: (string | undefined)[] = [];
  let readyOutcomes: boolean[] = [];

  const engine = createApplyEngine({
    store,
    restart: {
      backend: () => restarted.push('backend'),
      renderer: () => {
        restarted.push('renderer');
        rendererSaw.push(files['live.json'].components.frontend);
      },
      device: (c) => restarted.push(`device:${c}`),
    },
    awaitReady: () =>
      readyOutcomes.shift() === false
        ? Promise.reject(new Error('시간 초과'))
        : Promise.resolve(),
    onLog: (m) => logs.push(m),
  });

  return {
    engine,
    files,
    generations,
    restarted,
    rendererSaw,
    logs,
    setReady: (outcomes: boolean[]) => {
      readyOutcomes = outcomes;
    },
  };
}

describe('적용', () => {
  test('매니페스트에 없는 컴포넌트는 그대로 둔다 — 빠뜨렸다고 되돌아가면 안 된다', async () => {
    const h = harness({
      live: { frontend: 'f2', backend: '1.0.0' },
      present: ['token-dispenser@c2'],
    });

    await h.engine.apply(manifest({ 'token-dispenser': 'c2' }));

    expect(h.files['live.json'].components).toEqual({
      frontend: 'f2',
      backend: '1.0.0',
      'token-dispenser': 'c2',
    });
    expect(h.restarted).toEqual(['device:token-dispenser']);
  });

  test('백엔드만 교체하면 백엔드만 다시 띄운다 — 하드웨어는 살아있다', async () => {
    const h = harness({ present: ['backend@1.1.0'] });

    const result = await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect(result).toEqual({
      ok: true,
      applied: ['backend'],
      backendSurvives: false,
    });
    expect(h.restarted).toEqual(['backend']);
    expect(h.files['live.json'].components).toEqual({ backend: '1.1.0' });
  });

  test('성공해도 승격하지 않는다 — 승격 주체는 판정자 하나뿐이다', async () => {
    const h = harness({
      stable: { backend: '1.0.0' },
      present: ['backend@1.1.0'],
    });

    const result = await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect(result.ok).toBe(true);
    // 적용이 승격까지 하면 계약 판정을 앞질러 어긋난 조합을 "안전"으로 기록하게 된다.
    expect(h.files['last-stable.json'].components).toEqual({
      backend: '1.0.0',
    });
  });

  test('바뀐 게 없으면 아무것도 띄우지 않는다', async () => {
    const h = harness({ live: { backend: '1.0.0' } });

    const result = await h.engine.apply(manifest({ backend: '1.0.0' }));

    expect(result).toEqual({
      ok: true,
      applied: [],
      backendSurvives: true,
    });
    expect(h.restarted).toEqual([]);
  });

  test('없는 세대를 가리키면 포인터를 건드리지 않는다', async () => {
    const h = harness({ live: { backend: '1.0.0' } });

    const result = await h.engine.apply(manifest({ backend: '9.9.9' }));

    expect(result).toEqual({
      ok: false,
      reason: 'missing-generation',
      missing: ['backend'],
      backendSurvives: true,
    });
    expect(h.files['live.json'].components).toEqual({ backend: '1.0.0' });
    expect(h.restarted).toEqual([]);
  });

  test('프론트·장치만 바뀌면 준비 선언을 기다리지 않는다', async () => {
    const h = harness({
      present: ['frontend@2.0.0', 'token-dispenser@0.9.1'],
    });
    h.setReady([false]); // 기다렸다면 실패했을 것이다

    const result = await h.engine.apply(
      manifest({ frontend: '2.0.0', 'token-dispenser': '0.9.1' }),
    );

    expect(result.ok).toBe(true);
    expect(h.restarted).toEqual(['device:token-dispenser', 'renderer']);
  });

  test('검증하지 못한 조합은 안정으로 승격하지 않는다 — 흰 화면을 안전하다고 기록하면 안 된다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['frontend@2.0.0'],
    });

    await h.engine.apply(manifest({ frontend: '2.0.0' }));

    // live 는 갈렸지만 stable 은 그대로 — 되감을 목적지가 남아 있어야 한다.
    // 매니페스트에 없던 backend 는 그대로 유지된다(덮어쓰기).
    expect(h.files['live.json'].components).toEqual({
      backend: '1.0.0',
      frontend: '2.0.0',
    });
    expect(h.files['last-stable.json'].components).toEqual({
      backend: '1.0.0',
    });
  });
});

describe('렌더러 교체', () => {
  test('렌더러는 포인터가 갈린 뒤에 불린다 — 옛 URL 을 재해석하면 교체가 안 먹는다 ★', async () => {
    const h = harness({ present: ['frontend@f2'] });

    await h.engine.apply(manifest({ frontend: 'f2' }));

    expect(h.rendererSaw).toEqual(['f2']);
  });

  test('되감기 때도 되감은 세대를 본다', async () => {
    const h = harness({
      live: { frontend: 'f2', backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['backend@1.1.0'],
    });
    h.setReady([false, true]);

    await h.engine.apply(manifest({ backend: '1.1.0' }));

    // stable 에 frontend 가 없다 = baseline 이라는 뜻이다.
    expect(h.rendererSaw).toEqual([undefined]);
  });
});

describe('정리는 적용의 일이 아니다', () => {
  test('적용은 세대를 지우지 않는다 — 참조 집합은 승격이 확정한다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['backend@1.0.0', 'backend@1.1.0'],
    });

    await h.engine.apply(manifest({ backend: '1.1.0' }));

    // 아직 승격 전이라 1.0.0 은 되감을 곳으로 살아 있어야 한다.
    expect([...h.generations].sort()).toEqual(['1.0.0', '1.1.0']);
  });

  test('되감기도 세대를 지우지 않는다 — 되돌아온 곳이 곧 참조다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['backend@1.0.0', 'backend@1.1.0'],
    });
    h.setReady([false, true]);

    await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect([...h.generations]).toContain('1.0.0');
  });
});

describe('요청 잠금 해제 신호', () => {
  test('백엔드가 교체되면 응답하지 않는다 — 곧 죽으므로 풀어줄 필요가 없다', async () => {
    const h = harness({ present: ['backend@1.1.0'] });

    const result = await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect(result.backendSurvives).toBe(false);
  });

  test('프론트·장치만 갈리면 백엔드가 살아남는다 — 반드시 풀어줘야 한다', async () => {
    const h = harness({ present: ['frontend@2.0.0'] });

    const result = await h.engine.apply(manifest({ frontend: '2.0.0' }));

    expect(result.backendSurvives).toBe(true);
  });

  test('적용이 거절돼도 백엔드는 살아남는다', async () => {
    const h = harness({ live: { backend: '1.0.0' } });

    const declined = await h.engine.apply(manifest({ backend: '9.9.9' }));
    const unchanged = await h.engine.apply(manifest({ backend: '1.0.0' }));

    expect(declined.backendSurvives).toBe(true);
    expect(unchanged.backendSurvives).toBe(true);
  });
});

describe('되감기 사다리는 콜드 부팅에서도 오를 수 있어야 한다', () => {
  test('되감았는지를 알려준다 — 부르는 쪽이 다음 칸을 결정한다 ★', () => {
    const h = harness({
      live: { backend: '1.1.0' },
      stable: { backend: '1.0.0' },
    });

    expect(h.engine.descend('워치독')).toBe('stable');
    expect(h.files['live.json'].components).toEqual({ backend: '1.0.0' });
    // 두 번째는 stable 도 못 선 것이다 — 바닥으로.
    expect(h.engine.descend('워치독')).toBe('baseline');
  });

  test('한 칸씩 내려간다 — live → stable → 동봉본 ★', () => {
    const h = harness({
      live: { backend: '1.1.0' },
      stable: { backend: '1.0.0' },
    });

    expect(h.engine.descend('워치독')).toBe('stable');
    expect(h.files['live.json'].components).toEqual({ backend: '1.0.0' });

    // stable 마저 서지 못했다 — 바닥으로.
    expect(h.engine.descend('워치독')).toBe('baseline');
    expect(h.files['live.json'].components).toEqual({});

    expect(h.engine.descend('워치독')).toBeNull();
  });

  test('백엔드 세대가 그대로면 그래도 백엔드를 다시 띄운다 ★', () => {
    // live 와 stable 이 프론트만 다르다 — 멈춘 백엔드를 두고 끝나면 인앱 데드엔드다.
    const h = harness({ live: { frontend: 'f2' }, stable: {} });

    expect(h.engine.descend('워치독')).toBe('stable');

    expect(h.restarted).toEqual(['renderer', 'backend']);
  });

  test('바닥에서 stable 로 올라가지 않는다 — 두 조합을 오가며 진동한다 ★', () => {
    const h = harness({ live: {}, stable: { backend: '1.0.0' } });

    expect(h.engine.descend('워치독')).toBeNull();
    expect(h.files['live.json'].components).toEqual({});
    expect(h.restarted).toEqual([]);
  });
});

describe('되감기 사다리', () => {
  test('새 세대가 못 서면 마지막 안정 조합으로 되감는다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['backend@1.1.0'],
    });
    h.setReady([false, true]); // 새 세대 실패 → 되감은 세대 성공

    const result = await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect(result).toEqual({
      ok: false,
      reason: 'not-ready',
      rolledBackTo: 'stable',
      backendSurvives: false,
    });
    expect(h.files['live.json'].components).toEqual({ backend: '1.0.0' });
  });

  test('안정 조합마저 못 서면 baseline 으로 떨어진다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['backend@1.1.0'],
    });
    h.setReady([false, false]);

    const result = await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect(result).toEqual({
      ok: false,
      reason: 'not-ready',
      rolledBackTo: 'baseline',
      backendSurvives: false,
    });
    expect(h.files['live.json'].components).toEqual({});
  });

  test('목적지에 없는 컴포넌트도 baseline 으로 되돌아간다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      // stable 에 frontend 가 없다 = baseline 이어야 한다는 뜻이다.
      stable: { backend: '1.0.0' },
      present: ['backend@1.1.0', 'frontend@f2'],
    });
    // 먼저 프론트를 올려 live 에 얹어둔다(승격은 안 됨).
    await h.engine.apply(manifest({ frontend: 'f2' }));
    h.restarted.length = 0;
    h.setReady([false, true]);

    await h.engine.apply(manifest({ backend: '1.1.0' }));

    // 백엔드 실패 → stable 로 되감기. frontend 도 함께 baseline 으로 돌아가야 한다 —
    // 빠뜨리면 포인터가 실행 중인 것과 어긋난다.
    expect(h.files['live.json'].components).toEqual({ backend: '1.0.0' });
    expect(h.restarted).toContain('renderer');
  });

  test('실패한 조합은 안정으로 승격되지 않는다', async () => {
    const h = harness({
      live: { backend: '1.0.0' },
      stable: { backend: '1.0.0' },
      present: ['backend@1.1.0'],
    });
    h.setReady([false, true]);

    await h.engine.apply(manifest({ backend: '1.1.0' }));

    expect(h.files['last-stable.json'].components).toEqual({
      backend: '1.0.0',
    });
  });
});
