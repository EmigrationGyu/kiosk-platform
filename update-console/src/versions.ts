import type {
  ArtifactDescriptor,
  ArtifactSurfaces,
  HostKey,
  Target,
} from './types';
import { BASE_TARGET, matchesBackendSurfaces, UPDATE_COMPONENT } from './types';

/**
 * 어느 채널의 빌드인가 — **버전 문자열이 곧 표식**이다.
 *
 * `bump.mjs` 가 브랜치로 갈라 굽는다: master 는 `X.Y+1.0`, 그 외(develop)는 `X.Y.Z-N`.
 * 그래서 접미어의 유무가 채널이고, 별도 필드가 필요 없다.
 */
export type Channel = 'release' | 'development';

export const channelOf = (version: string): Channel =>
  version.includes('-') ? 'development' : 'release';

/**
 * 이 서버에서 제안해도 되는 채널인가.
 *
 * 개발 서버에는 개발 빌드를 올릴 수 있지만, staging·production 에 develop 브랜치
 * 코드를 올리면 안 된다. 산출물은 버킷 하나에 섞여 있으므로 **여기서 가른다.**
 */
export const allowsDevelopmentBuilds = (host: HostKey): boolean =>
  host === 'development';

/** 받아보기 전에 버전 문자열만으로 거를 수 있는 것 — 그만큼 요청이 줄어든다. */
export function passesChannel(version: string, host: HostKey): boolean {
  return allowsDevelopmentBuilds(host) || channelOf(version) === 'release';
}

/**
 * 배포해도 되는 산출물인가.
 *
 * 계약 지문이 없으면 **숨긴다.** 옛 산출물은 어느 계약으로 빌드됐는지 알 수 없어
 * 섞인 조합을 만들 수 있고, 안전한 조합만 제안하는 것이 이 화면의 일이다.
 *
 * 기준(`reference` = 기준 백엔드의 표면)이 주어지면 **자기 표면이 그 백엔드와 맞는
 * 것만** 통과한다. total 동일이 아니라 표면 일치인 이유: 무관한 계약 변경(다른 장치
 * 스키마)이 이 컴포넌트의 배포를 막으면 안 된다 — 표면이 맞으면 섞여도 정상이다.
 * 백엔드 자신과 앱 전체는 기준 그 자체라 표면으로 거르지 않는다.
 */
export function passesSurfaces(
  descriptor: ArtifactDescriptor,
  target: Target,
  reference?: ArtifactSurfaces,
): boolean {
  if (!descriptor.contractTotal) return false;
  if (target === BASE_TARGET || target === UPDATE_COMPONENT.BACKEND) {
    return true;
  }
  if (!reference) return true;
  return (
    matchesBackendSurfaces(target, descriptor.surfaces, reference) === true
  );
}

/** 최신순. `bakedAt` 이 진짜 순서다 — 버전 문자열은 채널이 섞이면 순서를 뒤집는다. */
export const newestFirst = (
  a: ArtifactDescriptor,
  b: ArtifactDescriptor,
): number => (b.bakedAt ?? '').localeCompare(a.bakedAt ?? '');
