import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BASELINE_GENERATION,
  BASELINE_VERSION_FILE,
  componentSegments,
  generationSegments,
  INITIAL_POINTER,
  LIVE_POINTER_FILE,
  type Pointer,
  PointerSchema,
  resolveGeneration,
  STABLE_POINTER_FILE,
  UPDATABLE_COMPONENTS,
  type UpdateComponent,
} from 'kiosk-types';

/**
 * 자식(serialport)의 실행 경로를 세대 포인터에서 해석한다. 백엔드가 해석하는 이유: "무엇을 띄울지"는
 * 언제 띄울지와 같은 정책이고, 메인에 넘기면 메인이 없는 토폴로지(node 타깃)에서 장치 부분 업데이트가
 * 사라진다. 포인터는 매번 다시 읽는다 — 캐시하면 교체 후 재spawn 이 옛 경로를 쓴다.
 */
function readPointerFile(file: string): Pointer {
  if (!existsSync(file)) return INITIAL_POINTER;
  try {
    return PointerSchema.parse(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return INITIAL_POINTER;
  }
}

export const readPointer = (artifactRoot: string): Pointer =>
  readPointerFile(path.join(artifactRoot, LIVE_POINTER_FILE));

/** 마지막으로 검증된 조합 — 보고용. 쓰는 것은 부모뿐이다. */
export const readStable = (artifactRoot: string): Pointer =>
  readPointerFile(path.join(artifactRoot, STABLE_POINTER_FILE));

/**
 * 이 세대가 디스크에 있는가. 세대 디렉토리는 **완성된 것만** 존재하므로(받는 중에는 `.staging`)
 * 존재 여부가 곧 "쓸 수 있다"는 뜻이고, 받다 만 것을 실행할 창이 없다.
 */
export function hasGeneration(
  artifactRoot: string,
  component: UpdateComponent,
  generation: string,
): boolean {
  return existsSync(
    path.join(artifactRoot, ...generationSegments(component, generation)),
  );
}

/** 이 컴포넌트가 지금 실행돼야 하는 진입 파일(절대경로). */
export function resolveEntry(
  artifactRoot: string,
  component: UpdateComponent,
): string {
  const dir = (generation: string) =>
    path.join(artifactRoot, ...generationSegments(component, generation));

  const wanted = dir(resolveGeneration(readPointer(artifactRoot), component));
  const chosen = existsSync(wanted) ? wanted : dir(BASELINE_GENERATION);
  return path.join(chosen, 'index.js');
}

/**
 * 주어진 성분들의 세대를 하나의 식별자로 굽는다 — 포인터가 갈리면 값도 갈린다. 목록을 순회해 만들므로
 * 포인터 파일의 키 순서에 흔들리지 않는다. 승격 판정이 "이 조합을 이미 봤는가"를 묻는 데 쓰고,
 * 근거마다 **그 근거가 보증하는 성분만** 골라 쓴다.
 */
export function combinationOf(
  artifactRoot: string,
  components: readonly UpdateComponent[] = UPDATABLE_COMPONENTS,
): string {
  const pointer = readPointer(artifactRoot);
  return components
    .map((component) => `${component}=${resolveGeneration(pointer, component)}`)
    .join(' ');
}

/**
 * 설치본에 동봉된 사본들의 실제 버전 — 보고용.
 *
 * 포인터에서 빠졌다는 것은 "갱신된 적 없다"이지 "무엇이 도는지 모른다"가 아니다. 서버에 `baseline`
 * 이라는 문자열을 실을 수 없어서 이 값이 필요하다. 값은 취합하는 쪽이 남긴 `version.json` 에 있다 —
 * dist 는 esbuild 번들 하나라 자기 버전을 안 들고 다니고 `package.json` 도 함께 복사되지 않는다
 * (실측: 그걸 읽으려다 전부 빈 채로 나갔다).
 *
 * **못 읽은 것은 그냥 빠진다** — 읽기 실패가 보고 전체를 막으면 파일 하나 때문에 그 키오스크가 통째로
 * "미보고"로 뜬다.
 */
export function readBaselineVersions(
  artifactRoot: string,
  components: readonly UpdateComponent[] = UPDATABLE_COMPONENTS,
): Partial<Record<UpdateComponent, string>> {
  const versions: Partial<Record<UpdateComponent, string>> = {};

  for (const component of components) {
    const manifest = path.join(
      artifactRoot,
      ...componentSegments(component),
      BASELINE_VERSION_FILE,
    );
    try {
      const { version } = JSON.parse(readFileSync(manifest, 'utf-8')) as {
        version?: unknown;
      };
      if (typeof version === 'string' && version.length > 0) {
        versions[component] = version;
      }
    } catch {
      // 이 컴포넌트만 빠진다 — 없는 값을 지어내지 않는다.
    }
  }

  return versions;
}
