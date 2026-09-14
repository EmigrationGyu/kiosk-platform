import type { Picks } from './ComponentPicker';
import type {
  ArtifactDescriptor,
  ArtifactSurfaces,
  UpdateComponent,
} from './types';
import { UPDATE_COMPONENT } from './types';

/** 컴포넌트 하나의 최신 버전을 가져온다. 기준(백엔드 표면)이 주어지면 맞는 것만. */
export type LoadLatest = (
  component: UpdateComponent,
  reference?: ArtifactSurfaces,
) => Promise<ArtifactDescriptor | undefined>;

export type FillResult = {
  picks: Picks;
  /** 기준 백엔드와 말이 통하는 버전이 없어 채우지 못한 것들. */
  missing: UpdateComponent[];
  /** 무엇을 기준으로 삼았는가 — 채울 백엔드가 아예 없으면 없다. */
  baseline?: ArtifactDescriptor;
};

/**
 * 모든 컴포넌트를 최신으로 채운다 — **기준은 백엔드다.**
 *
 * 계약 문자열이 아니라 백엔드 산출물이 기준인 이유: 이해관계는 프론트↔백엔드와
 * 백엔드↔장치 두 종류뿐이라, 모든 관계가 백엔드를 허브로 지난다. 사용자가 백엔드를
 * 골랐다면 그것이 기준이고, 안 골랐으면 가장 최근에 구운 백엔드가 기준이다.
 *
 * 나머지는 각자 **자기 표면**이 그 백엔드와 맞는 최신으로 따라온다 — 무관한 계약
 * 변경(다른 장치 스키마)이 있어도 표면이 맞으면 옛 세대 그대로 조합에 남을 수 있다.
 * total 동일을 요구하던 시절엔 그때마다 전 컴포넌트를 다시 구워야 했다.
 *
 * 맞는 버전이 없는 컴포넌트는 **채우지 않고 알린다.** 조용히 빼면 "왜 이것만 빠졌지"가
 * 되고, 아무거나 채우면 말이 안 통하는 조합을 만든다.
 */
export async function fillLatest(options: {
  components: readonly UpdateComponent[];
  picks: Picks;
  load: LoadLatest;
}): Promise<FillResult> {
  const { components, picks, load } = options;

  const baseline =
    picks[UPDATE_COMPONENT.BACKEND] ?? (await load(UPDATE_COMPONENT.BACKEND));
  if (!baseline) return { picks, missing: [...components] };

  const filled: Record<string, ArtifactDescriptor> = {
    ...picks,
    [UPDATE_COMPONENT.BACKEND]: baseline,
  };
  const missing: UpdateComponent[] = [];

  await Promise.all(
    components.map(async (component) => {
      if (filled[component]) return;
      const latest = await load(component, baseline.surfaces);
      if (latest) filled[component] = latest;
      else missing.push(component);
    }),
  );

  return { picks: filled, missing, baseline };
}
