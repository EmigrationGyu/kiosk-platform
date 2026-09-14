import type { ManifestBody } from './api';
import type { ArtifactDescriptor } from './types';
import { BASE_TARGET, COMPONENTS } from './types';

export type Mode = 'components' | 'base';

/**
 * 고른 것이 뜻하는 매니페스트 — 고른 것이 없으면 null.
 *
 * 두 축은 **구조적으로** 섞이지 않는다. 컴포넌트 조합은 `COMPONENTS` 닫힌 집합만 훑고
 * 앱 전체는 `BASE_TARGET` 한 자리만 본다 — 고른 것들을 통째로 훑으면 모드를 바꾸다 남은
 * 값이 딸려 나갈 수 있고, 그렇게 섞인 매니페스트는 키오스크가 거절한다(스키마가 둘을 함께
 * 받지 않는다). 수백 대에 보내는 화면이라 그 거절은 한꺼번에 난다.
 */
export function manifestBody(
  mode: Mode,
  picks: Readonly<Record<string, ArtifactDescriptor>>,
): ManifestBody | null {
  if (mode === 'base') {
    const chosen = picks[BASE_TARGET];
    return chosen ? { base: chosen.version } : null;
  }

  const components = Object.fromEntries(
    COMPONENTS.filter((component) => picks[component]).map((component) => [
      component,
      (picks[component] as ArtifactDescriptor).version,
    ]),
  );
  return Object.keys(components).length > 0 ? { components } : null;
}
