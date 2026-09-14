import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  componentSegments,
  type UpdateComponent,
} from 'kiosk-types/src/update/components';
import {
  BASELINE_GENERATION,
  GENERATIONS_DIR,
  generationSegments,
  INITIAL_POINTER,
  LIVE_POINTER_FILE,
  type Pointer,
  PointerSchema,
  resolveGeneration,
  STABLE_POINTER_FILE,
  UPDATABLE_COMPONENTS,
} from 'kiosk-types/src/update/generation';

/**
 * 참조되지 않은 세대의 보관 상한 — 받아뒀지만 아직 적용 안 한 세대는 살아남을 만큼 남기고
 * 무한정 쌓이지는 않게 한다. 프론트는 세대 하나가 19MB다.
 */
const SPARE_GENERATION_LIMIT = 3;

/**
 * 교체 가능한 사본(세대)의 저장소. electron 을 import 하지 않는다 — 루트만 주입받으면
 * 되고, 그래야 단위 테스트가 되고 나중에 supervisor 로 옮길 때도 그대로 간다.
 *
 * 세대를 userData 가 아니라 아티팩트 루트에 두는 이유: 앱 셸이 갈려도 옛 세대가 살아남으면
 * "새 셸 + 옛 백엔드" 조합이 생긴다. 루트가 `app-{버전}` 아래라 셸과 함께 새로 시작한다.
 */
export type GenerationStore = {
  /** 패키지 동봉본을 baseline 세대로 확보한다. 이미 있으면 아무것도 하지 않는다. */
  ensureBaselines(components: readonly UpdateComponent[]): void;
  /** 지금 가리키는 조합. 읽을 수 없으면 전부 baseline. */
  readPointer(): Pointer;
  /** 이 컴포넌트가 지금 실행돼야 하는 디렉토리(절대경로). */
  resolveDir(component: UpdateComponent): string;
  /** 이 세대가 디스크에 있는가. */
  hasGeneration(component: UpdateComponent, generation: string): boolean;
  /**
   * 지금 가리키는 조합을 바꾼다 — **live 만**. 한 파일이 전부를 가리키므로 여러 컴포넌트가
   * 함께 전환된다. 안정 조합은 `promoteLiveToStable` 하나만 쓸 수 있다: 쓰는 주체가 둘이면
   * 순서를 아무리 맞춰도 경합이 남는다(실측: 적용이 계약 판정을 앞질러 어긋난 조합을
   * "안전"으로 기록했다).
   */
  writePointer(pointer: Pointer): void;
  /** 마지막으로 건강하게 돌았던 조합. 없으면 전부 baseline. */
  readStable(): Pointer;
  /** 지금 가리키는 조합을 되감기 목적지로 승격한다 — 실제로 돈다는 증거를 받았을 때만. */
  promoteLiveToStable(): void;
  /**
   * 보관 상한을 적용해 오래된 세대를 잘라낸다(잘라낸 이름을 로그용으로 돌려준다).
   *
   * "참조되지 않으면 지운다"는 **미래를 모르는 규칙**이라 쓸 수 없다 — 받아뒀지만 아직
   * 적용하지 않은 세대는 참조가 없는데 곧 쓰인다(실측: 그 규칙이 큐에 있던 세대를 지웠다).
   * 그래서 참조(지금·되감을 곳·바닥)는 항상 남기고, 나머지는 최근 것부터 상한까지만 남긴다.
   *
   * `held` 는 저장소 밖의 참조 — 되돌림 스택이 붙드는 세대. 지우면 롤백 목적지가 사라진다.
   */
  pruneGenerations(held?: (component: UpdateComponent) => string[]): string[];
};

export function createGenerationStore(deps: {
  /** `resources/target` — 동봉본과 세대 저장소가 함께 있는 루트. */
  artifactRoot: string;
  onLog?: (message: string) => void;
}): GenerationStore {
  const { artifactRoot } = deps;
  const log = deps.onLog ?? (() => undefined);
  // 포인터는 경로 해석·정리마다 다시 읽으므로, 손상 경고를 그때마다 남기면 같은 사실이
  // 부팅당 여러 번 찍힌다. 파일별로 한 번만 알린다.
  const warned = new Set<string>();

  const shippedDir = (component: UpdateComponent): string =>
    path.join(artifactRoot, ...componentSegments(component));

  const generationDir = (
    component: UpdateComponent,
    generation: string,
  ): string =>
    path.join(artifactRoot, ...generationSegments(component, generation));

  function read(fileName: string): Pointer {
    const file = path.join(artifactRoot, fileName);
    if (!existsSync(file)) return INITIAL_POINTER;
    try {
      return PointerSchema.parse(JSON.parse(readFileSync(file, 'utf-8')));
    } catch (error) {
      // 손상된 포인터로 부팅을 막지 않는다 — 업데이트 실패가 기기 정지가 되면 안 된다.
      if (!warned.has(fileName)) {
        warned.add(fileName);
        log(
          `${fileName} 을 읽을 수 없습니다 — baseline 으로 진행합니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return INITIAL_POINTER;
    }
  }

  const readPointer = () => read(LIVE_POINTER_FILE);

  /** 임시 파일에 쓰고 rename — 중간 상태가 없어야 도중에 끊겨도 유효한 파일이 남는다. */
  function writeAtomic(fileName: string, pointer: Pointer): void {
    const target = path.join(artifactRoot, fileName);
    const staging = `${target}.staging`;
    writeFileSync(
      staging,
      `${JSON.stringify(pointer, null, 2)}
`,
    );
    renameSync(staging, target);
  }

  return {
    readPointer,
    readStable: () => read(STABLE_POINTER_FILE),

    hasGeneration: (component, generation) =>
      existsSync(generationDir(component, generation)),

    promoteLiveToStable() {
      // 손상됐으면 baseline 으로 읽힌 값이다 — 그게 **실제로 돌고 있는 조합**이다.
      const live = readPointer();
      writeAtomic(STABLE_POINTER_FILE, live);
      // 읽은 값을 그대로 다시 쓴다. 멀쩡했다면 같은 내용이고, 손상됐다면 이 쓰기가
      // **고친다** — 안 고치면 매 부팅 baseline 으로 떨어지며 경고만 반복한다.
      writeAtomic(LIVE_POINTER_FILE, live);
      warned.delete(LIVE_POINTER_FILE);
    },

    pruneGenerations(held = () => []) {
      const live = readPointer();
      const stable = read(STABLE_POINTER_FILE);
      const removed: string[] = [];

      for (const component of UPDATABLE_COMPONENTS) {
        const root = path.join(
          artifactRoot,
          ...componentSegments(component),
          GENERATIONS_DIR,
        );
        if (!existsSync(root)) continue;

        // baseline 은 불가침이다 — 사다리의 바닥이라 이것마저 지우면 돌아갈 곳이 없다.
        const referenced = new Set([
          BASELINE_GENERATION,
          resolveGeneration(live, component),
          resolveGeneration(stable, component),
          ...held(component),
        ]);

        // 참조되지 않은 것들만 최근순으로 줄 세워 상한을 넘는 만큼 자른다.
        const spare = readdirSync(root)
          .filter((generation) => !referenced.has(generation))
          .map((generation) => ({
            generation,
            at: statSync(path.join(root, generation)).mtimeMs,
          }))
          .sort((a, b) => b.at - a.at)
          .slice(SPARE_GENERATION_LIMIT);

        for (const { generation } of spare) {
          rmSync(path.join(root, generation), { recursive: true, force: true });
          removed.push(`${component}@${generation}`);
        }
      }
      return removed;
    },

    writePointer(pointer) {
      writeAtomic(LIVE_POINTER_FILE, pointer);
    },

    ensureBaselines(components) {
      for (const component of components) {
        const dest = generationDir(component, BASELINE_GENERATION);
        if (existsSync(dest)) continue;

        const source = shippedDir(component);
        if (!existsSync(source)) {
          log(`동봉본 없음, baseline 건너뜀: ${component}`);
          continue;
        }

        // 디렉토리째 복사하면 자기 하위로 복사하는 꼴이라 항목 단위로 옮긴다.
        // node_modules 는 뺀다 — 세대마다 복사하면 koffi 84MB 가 세대 수만큼 불어난다.
        mkdirSync(dest, { recursive: true });
        for (const entry of readdirSync(source)) {
          if (entry === 'node_modules' || entry === GENERATIONS_DIR) continue;
          cpSync(path.join(source, entry), path.join(dest, entry), {
            recursive: true,
          });
        }
        log(`baseline 확보: ${component}`);
      }
    },

    resolveDir(component) {
      const generation = resolveGeneration(readPointer(), component);
      const dir = generationDir(component, generation);
      if (existsSync(dir)) return dir;

      // baseline 은 불가침이라 반드시 존재한다.
      log(`세대 없음(${component}@${generation}) — baseline 으로 떨어집니다`);
      return generationDir(component, BASELINE_GENERATION);
    },
  };
}
