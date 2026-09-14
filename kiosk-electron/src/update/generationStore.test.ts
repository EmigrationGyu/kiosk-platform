import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGenerationStore } from './generationStore';

let root: string;

const write = (file: string, body: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'gen-store-'));
  // 패키지 동봉본을 흉내낸다.
  write(path.join(root, 'backend', 'index.js'), 'shipped-backend');
  write(path.join(root, 'frontend', 'index.html'), 'shipped-frontend');
  write(
    path.join(root, 'serialport', 'token-dispenser', 'index.js'),
    'shipped-cash',
  );
  // 네이티브 모듈 — 패키징이 채우는 플랫폼 자산이지 빌드 산출물이 아니다.
  write(
    path.join(
      root,
      'serialport',
      'token-dispenser',
      'node_modules',
      'koffi',
      'index.js',
    ),
    'native',
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const store = () => createGenerationStore({ artifactRoot: root });

describe('baseline 확보', () => {
  test('동봉본을 baseline 세대로 복사한다', () => {
    store().ensureBaselines(['backend', 'token-dispenser']);

    expect(
      readFileSync(
        path.join(root, 'backend', '.generations', 'baseline', 'index.js'),
        'utf-8',
      ),
    ).toBe('shipped-backend');
    expect(
      existsSync(
        path.join(
          root,
          'serialport',
          'token-dispenser',
          '.generations',
          'baseline',
          'index.js',
        ),
      ),
    ).toBe(true);
  });

  test('네이티브 모듈은 세대에 담지 않는다 — 세대들이 공유한다', () => {
    store().ensureBaselines(['token-dispenser']);

    const genDir = path.join(
      root,
      'serialport',
      'token-dispenser',
      '.generations',
      'baseline',
    );
    expect(existsSync(path.join(genDir, 'index.js'))).toBe(true);
    expect(existsSync(path.join(genDir, 'node_modules'))).toBe(false);
    // 원래 자리에는 그대로 있어야 한다 — 세대에서 위로 올라가면 여기서 해소된다.
    expect(
      existsSync(
        path.join(
          root,
          'serialport',
          'token-dispenser',
          'node_modules',
          'koffi',
        ),
      ),
    ).toBe(true);
  });

  test('이미 있으면 덮지 않는다 — baseline 은 불가침이다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    const file = path.join(
      root,
      'backend',
      '.generations',
      'baseline',
      'index.js',
    );
    writeFileSync(file, 'touched');

    s.ensureBaselines(['backend']);

    expect(readFileSync(file, 'utf-8')).toBe('touched');
  });

  test('동봉되지 않은 컴포넌트는 건너뛴다 — 다른 컴포넌트를 막지 않는다', () => {
    store().ensureBaselines(['ime', 'backend']);

    expect(
      existsSync(path.join(root, 'serialport', 'ime', '.generations')),
    ).toBe(false);
    expect(
      existsSync(path.join(root, 'backend', '.generations', 'baseline')),
    ).toBe(true);
  });
});

describe('경로 해석', () => {
  test('포인터가 없으면 baseline', () => {
    const s = store();
    s.ensureBaselines(['backend']);

    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', 'baseline'),
    );
  });

  test('포인터가 가리키는 세대로', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(
      path.join(root, 'backend', '.generations', '1.2.3', 'index.js'),
      'v2',
    );
    write(
      path.join(root, 'live.json'),
      JSON.stringify({ pointerVersion: 1, components: { backend: '1.2.3' } }),
    );

    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', '1.2.3'),
    );
  });

  test('가리키는 세대가 사라졌으면 baseline 으로 떨어진다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(
      path.join(root, 'live.json'),
      JSON.stringify({ pointerVersion: 1, components: { backend: '9.9.9' } }),
    );

    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', 'baseline'),
    );
  });

  test('포인터가 손상돼도 부팅을 막지 않는다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(path.join(root, 'live.json'), '{ 이건 JSON 이 아니다');

    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', 'baseline'),
    );
  });

  test('포인터를 매번 다시 읽는다 — 교체가 다음 spawn 에 반영돼야 한다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(
      path.join(root, 'backend', '.generations', '2.0.0', 'index.js'),
      'v3',
    );

    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', 'baseline'),
    );

    write(
      path.join(root, 'live.json'),
      JSON.stringify({ pointerVersion: 1, components: { backend: '2.0.0' } }),
    );

    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', '2.0.0'),
    );
  });
});

describe('손상된 포인터 복구', () => {
  const livePath = path.join('live.json');

  test('승격이 포인터를 고친다 — 안 고치면 매 부팅 baseline 으로 떨어진다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(path.join(root, 'live.json'), '{ 이건 JSON 이 아니다');

    // 손상된 상태에서 실제로 도는 것은 baseline 이다.
    expect(s.resolveDir('backend')).toBe(
      path.join(root, 'backend', '.generations', 'baseline'),
    );

    s.promoteLiveToStable();

    // 이제 읽을 수 있어야 한다 — 돌고 있던 조합(baseline)이 그대로 기록된다.
    expect(
      JSON.parse(readFileSync(path.join(root, livePath), 'utf-8')),
    ).toEqual({ pointerVersion: 1, components: {} });
  });

  test('멀쩡한 포인터는 승격이 바꾸지 않는다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(path.join(root, 'backend', '.generations', 'g1', 'index.js'), 'g1');
    s.writePointer({ pointerVersion: 1, components: { backend: 'g1' } });

    s.promoteLiveToStable();

    expect(
      JSON.parse(readFileSync(path.join(root, livePath), 'utf-8')).components,
    ).toEqual({ backend: 'g1' });
  });

  test('손상 경고는 파일당 한 번만 남긴다 — 읽을 때마다 찍으면 부팅당 여러 번이다', () => {
    const logs: string[] = [];
    const s = createGenerationStore({
      artifactRoot: root,
      onLog: (m) => logs.push(m),
    });
    s.ensureBaselines(['backend']);
    write(path.join(root, 'live.json'), '{ 깨짐');

    s.resolveDir('backend');
    s.resolveDir('backend');
    s.pruneGenerations();

    expect(logs.filter((m) => m.includes('읽을 수 없습니다'))).toHaveLength(1);
  });
});

describe('보관 상한', () => {
  const genFile = (
    component: string,
    generation: string,
    file = 'index.js',
  ) => {
    const segments =
      component === 'backend' || component === 'frontend'
        ? [component]
        : ['serialport', component];
    return path.join(root, ...segments, '.generations', generation, file);
  };
  const genDir = (component: string, generation: string) =>
    path.dirname(genFile(component, generation));

  const setPointer = (file: string, components: Record<string, string>) =>
    write(
      path.join(root, file),
      JSON.stringify({ pointerVersion: 1, components }),
    );

  /** 세대를 만들되 생성 시각을 어긋나게 둔다 — 최근순 판정을 검증하기 위해. */
  const writeAged = (component: string, generation: string, agoMs: number) => {
    write(genFile(component, generation), generation);
    const at = new Date(Date.now() - agoMs);
    utimesSync(genDir(component, generation), at, at);
  };

  test('참조된 것은 언제나 남는다 — 지금·되감을 곳·바닥', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(genFile('backend', 'live'), 'live');
    write(genFile('backend', 'stable'), 'stable');
    setPointer('live.json', { backend: 'live' });
    setPointer('last-stable.json', { backend: 'stable' });

    expect(s.pruneGenerations()).toEqual([]);
    for (const g of ['live', 'stable', 'baseline'])
      expect(existsSync(genDir('backend', g))).toBe(true);
  });

  test('아직 적용하지 않은 세대를 지우지 않는다 ★', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    // 받아뒀지만 매니페스트가 아직 안 온 세대 — 참조가 없어도 곧 쓰인다.
    write(genFile('backend', 'staged'), 'staged');
    setPointer('live.json', { backend: 'baseline' });

    expect(s.pruneGenerations()).toEqual([]);
    expect(existsSync(genDir('backend', 'staged'))).toBe(true);
  });

  test('상한을 넘으면 오래된 것부터 자른다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    writeAged('backend', 'newest', 1_000);
    writeAged('backend', 'mid', 10_000);
    writeAged('backend', 'old', 20_000);
    writeAged('backend', 'oldest', 30_000);

    expect(s.pruneGenerations()).toEqual(['backend@oldest']);
    expect(existsSync(genDir('backend', 'newest'))).toBe(true);
    expect(existsSync(genDir('backend', 'oldest'))).toBe(false);
  });

  test('참조된 것은 상한 계산에 들어가지 않는다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    setPointer('live.json', { backend: 'live' });
    writeAged('backend', 'live', 100_000); // 참조되지만 가장 오래됨
    writeAged('backend', 'a', 1_000);
    writeAged('backend', 'b', 2_000);
    writeAged('backend', 'c', 3_000);

    // 참조(live·baseline)를 빼면 a·b·c 셋뿐이라 상한에 걸리지 않는다.
    expect(s.pruneGenerations()).toEqual([]);
    expect(existsSync(genDir('backend', 'live'))).toBe(true);
  });

  test('baseline 은 아무리 오래돼도 자르지 않는다 — 사다리의 바닥이다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    const long = new Date(0);
    utimesSync(genDir('backend', 'baseline'), long, long);
    for (const g of ['a', 'b', 'c', 'd']) writeAged('backend', g, 1_000);

    s.pruneGenerations();

    expect(existsSync(genDir('backend', 'baseline'))).toBe(true);
  });

  test('되돌림 스택이 붙드는 세대는 자르지 않는다 — 롤백 목적지다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    setPointer('live.json', { backend: 'a' });
    writeAged('backend', 'a', 1_000);
    writeAged('backend', 'b', 2_000);
    writeAged('backend', 'c', 3_000);
    writeAged('backend', 'd', 4_000);
    writeAged('backend', 'held', 50_000); // 가장 오래됐지만 스택이 붙든다

    // 보호하면 여분이 b·c·d 셋뿐이라 상한에 걸리지 않는다.
    expect(
      s.pruneGenerations((component) =>
        component === 'backend' ? ['held'] : [],
      ),
    ).toEqual([]);
    expect(existsSync(genDir('backend', 'held'))).toBe(true);
    // 보호가 없으면 가장 오래된 held 가 잘린다 — 롤백 목적지가 사라진다.
    expect(s.pruneGenerations()).toEqual(['backend@held']);
  });

  test('컴포넌트마다 따로 센다 — 한쪽이 많다고 다른 쪽이 잘리지 않는다', () => {
    const s = store();
    s.ensureBaselines(['backend', 'frontend']);
    for (const g of ['a', 'b', 'c', 'd']) writeAged('backend', g, 10_000);
    writeAged('frontend', 'only', 1_000);

    const removed = s.pruneGenerations();

    expect(removed).toHaveLength(1);
    expect(removed[0]?.startsWith('backend@')).toBe(true);
    expect(existsSync(genDir('frontend', 'only'))).toBe(true);
  });

  test('중첩된 파일이 있어도 세대 디렉토리째 자른다', () => {
    const s = store();
    s.ensureBaselines(['frontend']);
    for (const g of ['a', 'b', 'c']) writeAged('frontend', g, 1_000);
    // 파일을 먼저 채우고 시각을 되돌린다 — 디렉토리에 쓰면 mtime 이 갱신된다.
    write(genFile('frontend', 'victim', 'index.html'), 'html');
    write(genFile('frontend', 'victim', path.join('assets', 'app.js')), 'js');
    writeAged('frontend', 'victim', 90_000);

    s.pruneGenerations();

    expect(existsSync(genDir('frontend', 'victim'))).toBe(false);
  });

  test('세대 디렉토리가 없는 컴포넌트는 건너뛴다', () => {
    expect(() => store().pruneGenerations()).not.toThrow();
  });
});

describe('승격과 정리의 순서', () => {
  const genDir = (generation: string) =>
    path.join(root, 'backend', '.generations', generation);

  test('승격 뒤에 정리해도 새 조합은 참조라 살아남는다', () => {
    const s = store();
    s.ensureBaselines(['backend']);
    write(path.join(genDir('new'), 'index.js'), 'new');
    s.writePointer({ pointerVersion: 1, components: { backend: 'new' } });

    s.promoteLiveToStable();
    s.pruneGenerations();

    expect(existsSync(genDir('new'))).toBe(true);
  });
});
