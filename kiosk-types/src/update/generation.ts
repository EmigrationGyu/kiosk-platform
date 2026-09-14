import { z } from 'zod';
import { SERIALPORT_PROCESS } from '../serialport/processes';
import {
  componentSegments,
  UPDATE_COMPONENT,
  type UpdateComponent,
} from './components';

/**
 * 교체 가능한 사본(세대)의 디스크 레이아웃과 포인터 — 단일 출처.
 *
 * junction 이 아니라 포인터 **파일**인 이유: 기존 junction 위로는 rename 이 안 되고(실측) unlink 후
 * 재생성해야 해서 그 사이 대상이 사라지는 창이 생긴다. 파일 rename 은 중간 상태가 없고, 한 파일이
 * 전부를 가리키므로 계약이 얽힌 컴포넌트들을 함께 전환할 수 있다.
 *
 * 세대 이름은 곧 패키지 버전이다 — CI 가 올리는 단위이자 서버가 지시하는 단위다.
 */

/** 세대 사본들이 모여 있는 디렉토리 이름 (**각 컴포넌트 디렉토리 아래**). */
export const GENERATIONS_DIR = '.generations';

/** 패키지 동봉본. **불가침** — 복구 사다리의 바닥이라 이게 갈리면 돌아갈 곳이 없다. */
export const BASELINE_GENERATION = 'baseline';

/** 지금 가리키는 조합. */
export const LIVE_POINTER_FILE = 'live.json';

/** 마지막으로 건강하게 돌았음이 확인된 조합 — 되감기 목적지. */
export const STABLE_POINTER_FILE = 'last-stable.json';

/**
 * 세대 사본의 위치 (아티팩트 루트 기준 상대 세그먼트). 컴포넌트 디렉토리 **안**에 두는 이유:
 * 세대는 CI 가 올리는 것(`dist/`)만 담고 네이티브 모듈은 공유해야 하는데(koffi 84MB×2), 공유하려면
 * node 모듈 해소 경로에 걸려야 한다 — `…/token-dispenser/.generations/1.2.3/` 에서 위로 올라가면
 * `…/token-dispenser/node_modules` 를 만난다.
 */
export function generationSegments(
  component: UpdateComponent,
  generation: string,
): string[] {
  return [...componentSegments(component), GENERATIONS_DIR, generation];
}

/** 교체 가능한 컴포넌트 전부 — `bun gen bs` 가 주입하면 자동으로 늘어난다. */
export const UPDATABLE_COMPONENTS: readonly UpdateComponent[] = [
  ...Object.values(UPDATE_COMPONENT),
  ...Object.values(SERIALPORT_PROCESS),
];

/** 컴포넌트 → 세대. 부분집합이면 된다 — 옛 포인터가 새 컴포넌트를 만나도 유효하도록. */
export const GenerationMapSchema = z.partialRecord(
  z.enum(UPDATABLE_COMPONENTS as [UpdateComponent, ...UpdateComponent[]]),
  z.string().min(1),
);

export type GenerationMap = z.infer<typeof GenerationMapSchema>;

/** 포인터 파일의 내용. */
export const PointerSchema = z.object({
  /** 형식이 바뀌어도 옛 파일을 읽을 수 있게 한다. */
  pointerVersion: z.literal(1),
  components: GenerationMapSchema,
});

export type Pointer = z.infer<typeof PointerSchema>;

/** 아직 아무 세대도 없을 때의 포인터 — 전부 baseline. */
export const INITIAL_POINTER: Pointer = { pointerVersion: 1, components: {} };

/**
 * 서버가 지시하는 **원하는 상태 전체**. 부분(델타)이 아니라 전체인 이유: 멱등하고, 순서 문제가
 * 없고, 되감기도 그냥 또 하나의 매니페스트가 된다.
 *
 * 세대 id·파일 해시·재기동 범위는 담지 않는다 — 각각 키오스크 내부 명명 / 저장소가 소유 /
 * 컴포넌트에서 유도되는 사실이라, 서버가 지시하면 서버가 그걸 틀릴 수 있게 된다.
 */
export const ManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    /** 세대를 갈아끼울 컴포넌트들. base 만 보낼 때는 비어 있다. */
    components: GenerationMapSchema.default({}),
    /**
     * 앱 껍데기(설치본) 버전 — 있으면 **전체 교체**다. `components` 와 다른 축인 이유: 세대 교체는
     * 디렉토리를 갈고 자식을 다시 띄우는 일이지만 base 교체는 **부모까지 포함해 전부** 갈아치워
     * 아티팩트 루트가 통째로 새것이 된다(세대도 포인터도 사라진다).
     *
     * 이름이 `electron` 이 아닌 이유: 기술이 아니라 **역할**이다 — node 오케스트레이터로 옮겨가면
     * electron 은 없어지지만 "모든 것을 담는 껍데기"는 남는다.
     */
    base: z.string().min(1).optional(),
  })
  .refine(
    (manifest) =>
      manifest.base === undefined ||
      Object.keys(manifest.components).length === 0,
    {
      message:
        'base 와 components 를 함께 보낼 수 없습니다 — base 설치가 세대를 전부 새로 놓습니다',
    },
  );

export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * 부모에게 넘기는 적용 지시. 결과 기록이 **어느 지시의 결과인지** 맞대볼 수 있어야 하므로
 * commandId 를 함께 나른다 — 하네스처럼 서버 지시 없이 들어오는 문은 null 이다.
 */
export const ApplyInstructionSchema = z.object({
  commandId: z.string().nullable(),
  /**
   * 도메인 → 서버 배포 행 id — 결과를 행 단위로 되돌려보낼 좌표. 여기서 끊기면 부모가 기록에
   * 좌표를 못 남기고, 재부팅 뒤 보고할 때 어느 행이었는지 알 길이 사라진다. default 로 두는 것은
   * 이 필드를 모르는 세대가 보낸 지시도 파싱되게 하려는 것이다(빈 맵 = 서버 지시가 아니다).
   */
  deploymentIds: z.record(z.string(), z.string()).default({}),
  manifest: ManifestSchema,
  /**
   * 받아둔 설치본의 절대 경로 — `base` 매니페스트일 때만 채워진다. 매니페스트에 실려 오는 값이
   * 아니라 **받은 쪽이 채운다**: 파일 이름은 서술자가 정하므로 여기 싣지 않으면 부모가 디렉토리를
   * 뒤져야 하고 경로 지식의 출처가 둘이 된다. default 인 이유는 아래 `kind` 와 같다.
   */
  baseInstaller: z.string().nullable().default(null),
  /**
   * 되돌림 스택에 대한 방향. `apply` 는 밀려난 조합을 push 하고, `rollback` 은 push
   * 없이 성공 시 pop 한다 — 연달아 누르면 한 단계씩 계속 내려간다.
   */
  kind: z.enum(['apply', 'rollback']).default('apply'),
});

export type ApplyInstruction = z.infer<typeof ApplyInstructionSchema>;

/**
 * 매니페스트를 현재 포인터에 **덮어써서** 새 포인터를 만든다.
 *
 * 빠진 컴포넌트는 **그대로 둔다**. 되돌리려면 `baseline` 을 명시해야 한다 — 서버가 하나를 빠뜨렸을
 * 때 조용히 되돌아가면 실행 중인 것과 포인터가 어긋난다(실측: 장치 하나를 적용했더니 프론트가
 * baseline 으로 되돌아갔다). 재기동 판정도 같은 규칙을 쓴다.
 */
export function pointerFromManifest(
  manifest: Manifest,
  current: Pointer,
): Pointer {
  return {
    pointerVersion: 1,
    components: { ...current.components, ...manifest.components },
  };
}

/**
 * 두 조합의 차이 — 재기동해야 하는 컴포넌트.
 *
 * **양쪽 다 완전한 포인터로 읽는다**(없음 = baseline). 부분 매니페스트를 직접 비교하면 "빠짐"을
 * 한쪽은 "건드리지 않음"으로 다른 쪽은 "baseline 으로"로 읽어 어긋난다(실측). 적용은 매니페스트를
 * 현재에 덮어쓴 것을 target 으로 주고, 되감기는 목적지 포인터를 그대로 준다.
 */
export function diffPointers(
  current: Pointer,
  target: Pointer,
): UpdateComponent[] {
  return UPDATABLE_COMPONENTS.filter(
    (component) =>
      resolveGeneration(current, component) !==
      resolveGeneration(target, component),
  );
}

/** 없으면 baseline — 여기서 던지면 업데이트 실패가 아니라 기기 정지가 된다. */
export function resolveGeneration(
  pointer: Pointer,
  component: UpdateComponent,
): string {
  return pointer.components[component] ?? BASELINE_GENERATION;
}
