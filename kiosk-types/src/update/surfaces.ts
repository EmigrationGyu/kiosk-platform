import type { UpdateComponent } from './components';

/**
 * 산출물이 신고하는 통신 표면 지문 — "이 산출물은 누구와 어떤 계약으로 말하는가".
 *
 * total 과 달리 **관계 단위**다: 프론트는 네임스페이스 합성 하나, 장치는 자기 프로세스 하나, 백엔드는
 * 허브라 전부 싣는다. 판정을 표면에 걸어야 무관한 계약 변경이 프론트를 되감지 않는다.
 * zod 를 쓰지 않는다 — 콘솔(Vercel, 서브모듈에 install 없음)이 직접 import 한다.
 */
export type ArtifactSurfaces = {
  /** 프론트엔드 ↔ 백엔드 합성 지문. 프론트·백엔드 산출물이 싣는다. */
  frontendBackend?: string;
  /** 백엔드 ↔ 장치, 프로세스별. 장치는 자기 것 하나, 백엔드는 전부. */
  processes?: Record<string, string>;
};

/** 이 컴포넌트 산출물이 실어야 하는 표면 — CI(bake)와 하네스가 같은 규칙을 쓴다. */
export function artifactSurfacesFor(
  component: UpdateComponent,
  contract: { frontendBackend: string; processes: Record<string, string> },
): ArtifactSurfaces {
  if (component === 'frontend') {
    return { frontendBackend: contract.frontendBackend };
  }
  if (component === 'backend') {
    return {
      frontendBackend: contract.frontendBackend,
      processes: { ...contract.processes },
    };
  }
  const hash = contract.processes[component];
  return { processes: hash === undefined ? {} : { [component]: hash } };
}

/**
 * 이 산출물이 기준 백엔드와 말이 통하는가 — 콘솔의 조합 제안이 쓰는 판정. `undefined` 는 "판정 불가"
 * 다(표면을 싣지 않는 옛 산출물). 불일치와 구별해야 한다 — 옛 산출물은 위험해서가 아니라 몰라서
 * 못 고르는 것이다.
 */
export function matchesBackendSurfaces(
  component: UpdateComponent,
  surfaces: ArtifactSurfaces | undefined,
  backend: ArtifactSurfaces | undefined,
): boolean | undefined {
  if (component === 'backend') return true; // 기준 그 자체다.
  if (!surfaces || !backend) return undefined;

  if (component === 'frontend') {
    if (!surfaces.frontendBackend || !backend.frontendBackend) return undefined;
    return surfaces.frontendBackend === backend.frontendBackend;
  }

  const mine = surfaces.processes?.[component];
  const reference = backend.processes?.[component];
  if (!mine || !reference) return undefined;
  return mine === reference;
}
