/**
 * 콘솔이 아는 계약.
 *
 * 컴포넌트 식별자는 **types 소스에서 직접** 읽는다(사본 금지 — prefix 를 규칙으로
 * 조립했다가 프론트에서 어긋나 산출물을 404 로 못 찾은 적이 있다. 목록도 같은 함정이다).
 * 버전 목록을 붙일 때 필요해지는 `artifactPrefix` 도 같은 모듈에 있다.
 *
 * ⚠ zod 를 쓰는 types 모듈(`update/generation` 등)은 import 하지 않는다. Vercel 은
 * 서브모듈을 클론할 뿐 그 안에서 install 하지 않아 zod 가 없다. 매니페스트는 형태가
 * 단순하므로 여기서 직접 세운다 — 검증은 서버가 아니라 키오스크가 한다.
 */

import { SERIALPORT_PROCESS } from '../../kiosk-types/src/serialport/processes';
import {
  artifactPrefix,
  BASE_ARTIFACT_PREFIX,
  UPDATE_COMPONENT,
  type UpdateComponent,
} from '../../kiosk-types/src/update/components';
import {
  type ArtifactSurfaces,
  matchesBackendSurfaces,
} from '../../kiosk-types/src/update/surfaces';
import type { EntityVersion } from './fleet/types';

/**
 * 다시 내보내는 것 — 갈아끼울 수 있는 컴포넌트 식별자와, 표면 판정(키오스크 witness 와
 * 같은 규칙: types 단일 출처, zod-free).
 */
export {
  type ArtifactSurfaces,
  artifactPrefix,
  matchesBackendSurfaces,
  UPDATE_COMPONENT,
  type UpdateComponent,
};

export const COMPONENTS: readonly UpdateComponent[] = [
  ...Object.values(UPDATE_COMPONENT),
  ...Object.values(SERIALPORT_PROCESS),
];

/**
 * 앱 껍데기 — 컴포넌트가 **아니다.**
 *
 * 세대를 갈아끼우는 것이 아니라 전부를 갈아치우므로 같이 보낼 수 없고(키오스크 스키마가
 * 막는다), 계약도 설치본 안에서 이미 맞아 있어 조합을 따질 대상이 아니다. 그래서 화면도
 * 둘 중 하나를 고르는 모드로 가른다.
 */
export const BASE_TARGET = 'base' as const;

/** 버전 목록을 붙일 수 있는 것 — 컴포넌트이거나 앱 전체다. */
export type Target = UpdateComponent | typeof BASE_TARGET;

export const prefixOf = (target: Target): string =>
  target === BASE_TARGET ? BASE_ARTIFACT_PREFIX : artifactPrefix(target);

/** 화면에 뜨는 이름. 컴포넌트는 식별자가 곧 이름이지만 앱 전체는 아니다. */
export const labelOf = (target: Target): string =>
  target === BASE_TARGET ? '앱 전체 (설치본)' : target;

/**
 * 버전 옆에 보여줄 지문 — **그 컴포넌트의 관계 표면**이다.
 *
 * total 을 보여주면 무관한 변경에도 값이 갈려 "왜 다른데 배포가 되지?"가 된다.
 * 프론트는 프론트↔백엔드 합성, 장치는 자기 프로세스, 백엔드·앱 전체는 세트 참고용
 * total 을 보여준다. 표면이 없는 옛 산출물은 total 로라도 표시한다.
 */
export const surfaceOf = (
  target: Target,
  descriptor: ArtifactDescriptor,
): string | undefined => {
  if (target === BASE_TARGET || target === UPDATE_COMPONENT.BACKEND) {
    return descriptor.contractTotal;
  }
  if (target === UPDATE_COMPONENT.FRONTEND) {
    return descriptor.surfaces?.frontendBackend ?? descriptor.contractTotal;
  }
  return descriptor.surfaces?.processes?.[target] ?? descriptor.contractTotal;
};

/** 구운 시각 — 서술자에 없으면 옛 산출물이다. */
export const bakedAtOf = (descriptor: ArtifactDescriptor): string =>
  descriptor.bakedAt
    ? new Date(descriptor.bakedAt).toLocaleString('ko-KR')
    : '시각 미상';

/** 산출물이 놓인 곳. 키오스크가 받는 곳과 같아야 한다. */
export const ARTIFACT_BASE_URL =
  'https://kiosk-artifacts-example.s3.ap-northeast-2.amazonaws.com';

/** S3 의 `artifact.json` — 뒤늦게 추가된 필드는 옛 산출물에 없다. */
export type ArtifactDescriptor = {
  descriptorVersion: 1;
  version: string;
  component?: string;
  contractTotal?: string;
  /** 통신 표면별 지문 — 조합 제안의 판정 근거. 옛 산출물엔 없다. */
  surfaces?: ArtifactSurfaces;
  bakedAt?: string;
  description?: string;
  url: string;
  sha256: string;
  sigUrl: string;
};

/**
 * 롤백 — 목적지를 싣지 않는다. 어디로 돌아갈지는 키오스크의 되돌림 스택이 안다(직전에
 * 밀려난 조합, 설치본 축 포함). 스택이 비어 있으면 키오스크가 거절한다.
 */
export const ROLLBACK_UPDATE_CONTROL = 'rollbackUpdate';

export type Kiosk = {
  id: string;
  name: string;
  connectionState: string;
  /** 관리자 조회에서만 채워진다 — 여러 업장이 섞여 나오므로 구분이 필요하다. */
  accommodationName?: string;
  /**
   * 티어의 단위는 업장이므로 **id 가 필요하다** — 이름은 바뀔 수 있고 중복될 수 있어
   * 배정의 키가 될 수 없다. 화면 묶기는 계속 이름으로 한다(사람이 읽는 것).
   */
  accommodationId?: string;
  /**
   * 이 키오스크가 돈다고 말한 것 — `Kiosk.versions`.
   *
   * 목록 쿼리에 함께 실린다. 배치로 가져올 경로가 이것뿐이라(`entityVersions` 는 기기당
   * 한 번이다) 실재만 따로 묻는 포트를 두지 않았다.
   */
  versions: EntityVersion[];
};

export type Accommodation = {
  id: string;
  name: string;
  kiosks: Kiosk[];
};

/**
 * 목록을 어떻게 얻었는가.
 *
 * 서버가 `searchKiosks` 를 관리자에게만 열어두므로, **시도해보고 통과하면 관리자**다.
 * 역할을 따로 묻는 쿼리를 두지 않는 이유: 권한의 진실은 서버에 있고, 그것을 클라이언트가
 * 다시 판정하면 두 곳이 어긋날 수 있다.
 */
export type Scope =
  | {
      kind: 'admin';
      kiosks: Kiosk[];
      total: number;
      /** 더 불러올 것이 있으면 그 자리. 없으면 null. */
      after: string | null;
    }
  | { kind: 'member'; accommodations: Accommodation[] };

/**
 * 어느 서버를 볼 것인가 — 키오스크가 보는 곳과 같아야 지시가 닿는다.
 *
 * 주소는 배포 환경이 정한다(`VITE_HOST_STAGING` · `VITE_HOST_DEVELOPMENT`). 소스에 박으면
 * 콘솔을 다른 서버로 돌릴 때마다 빌드를 고쳐야 하고, 공개 저장소에는 남길 수도 없다.
 */
export const HOSTS = {
  staging:
    import.meta.env.VITE_HOST_STAGING ?? 'https://staging.example.invalid',
  development:
    import.meta.env.VITE_HOST_DEVELOPMENT ??
    'https://development.example.invalid',
} as const;

export type HostKey = keyof typeof HOSTS;
