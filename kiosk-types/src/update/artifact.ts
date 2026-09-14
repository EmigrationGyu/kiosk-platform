import { z } from 'zod';
import {
  artifactPrefix,
  BASE_ARTIFACT_PREFIX,
  type UpdateComponent,
} from './components';

/**
 * 받아올 산출물의 서술자 — S3 의 `{prefix}/{version}/artifact.json` 에 놓인다. supervisor 가 자기
 * 자식을 받을 때와 **같은 모양**이고 검증 절차도 같다: 받고 → sha256 대조 → 서명 검증.
 *
 * 산출물을 **하나의 아카이브로 묶는 이유**: 낱개 파일이면(프론트는 수십 개다) 실패 지점이 파일
 * 수만큼 생기고 반쯤 받은 세대가 남는다. 하나면 staging 에 풀고 rename 하는 것으로 끝난다.
 */
export const ArtifactDescriptorSchema = z.object({
  descriptorVersion: z.literal(1),
  /** 이 산출물의 버전 = 세대 이름. */
  version: z.string().min(1),
  /**
   * 어느 컴포넌트인가 — prefix 에서 역으로 추측하지 않아도 되게 데이터가 들고 있는다.
   *
   * 아래 셋은 **뒤늦게 추가됐다.** 그래서 optional 이고 `descriptorVersion` 도 1로 둔다: 올리면 이미
   * 배포된 키오스크가 새 산출물을 거부한다(스키마가 literal(1)).
   */
  component: z.string().min(1).optional(),
  /**
   * 이 산출물이 빌드된 계약의 전체 지문. 판정은 아래 `surfaces` 가 대신하고(관계 단위 — 무관한
   * 변경이 발목을 안 잡게), 이 값은 "완전히 같은 types 로 빌드된 세트인가"의 참고 표시다.
   */
  contractTotal: z.string().min(1).optional(),
  /**
   * 통신 표면별 지문 — 콘솔의 조합 제안과 키오스크 일치 판정의 근거. 프론트는 `frontendBackend`,
   * 장치는 `processes[자기]`, 백엔드는 허브라 전부 싣는다. 모양·판정 규칙은 `update/surfaces.ts`
   * 단일 출처(zod-free — 콘솔이 직접 import).
   */
  surfaces: z
    .object({
      frontendBackend: z.string().min(1).optional(),
      processes: z.record(z.string(), z.string().min(1)).optional(),
    })
    .optional(),
  /** 구운 시각. "최신"의 근거 — 버전 문자열로 prerelease 순서를 추측하지 않는다. */
  bakedAt: z.iso.datetime().optional(),
  /**
   * 사람이 읽는 변경 요약 — 릴리스 워크플로의 선택 입력에서 온다. 기술 변경 이력이 아니라
   * 운영자가 배포를 고르는 순간 읽는 값이라 커밋 제목 같은 자동 채움을 두지 않았고, 비면
   * 이 키 자체가 없다(콘솔이 "설명 없음"으로 그린다). 버킷이 public read 라 업장명 금지.
   */
  description: z.string().optional(),
  /** 아카이브(tar.gz) 절대 URL. */
  url: z.string().url(),
  /** 아카이브의 sha256(hex). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** 서명 파일 절대 URL — 아카이브 바이트에 대한 RSASSA-PKCS1-v1_5/SHA-256 서명. */
  sigUrl: z.string().url(),
});

export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;

/** 아카이브 파일 이름 — CI 와 다운로더가 같은 값을 봐야 한다. */
export const ARTIFACT_ARCHIVE = 'dist.tar.gz';
export const ARTIFACT_SIGNATURE = `${ARTIFACT_ARCHIVE}.sig`;
export const ARTIFACT_DESCRIPTOR = 'artifact.json';

/**
 * 설치본에 동봉된 사본의 버전을 적어두는 파일 — `target/{컴포넌트}/` 안.
 *
 * **취합하는 쪽이 남긴다.** 세대는 디렉토리 이름이 곧 버전이지만 동봉본은 그런 이름이 없고 dist 는
 * 자기 버전을 안 들고 다닌다 — 파일을 놓는 순간이 그 사실을 아는 유일한 시점이다. CI 취합과 로컬
 * 취합이 **둘 다** 남겨야 한다(실측: 한쪽만 남겨 로컬 빌드가 전부 `—` 였다).
 */
export const BASELINE_VERSION_FILE = 'version.json';

const versionUrl = (baseUrl: string, prefix: string, version: string) =>
  `${baseUrl.replace(/\/+$/, '')}/${prefix}/${version}`;

/** `{base}/{prefix}/{version}` — 이 버전 산출물들이 놓인 곳. */
export function artifactVersionUrl(
  baseUrl: string,
  component: UpdateComponent,
  version: string,
): string {
  return versionUrl(baseUrl, artifactPrefix(component), version);
}

/**
 * `{base}/{BASE_ARTIFACT_PREFIX}/{version}` — 앱 설치본이 놓인 곳. 서술자 모양은 컴포넌트와 같지만
 * payload 가 아카이브가 아니라 설치본 exe 다. 받는 쪽은 `url` 의 파일 이름을 그대로 쓴다 — 이름을
 * 상수로 또 적으면 CI 가 바꿨을 때 조용히 어긋난다.
 */
export function baseVersionUrl(baseUrl: string, version: string): string {
  return versionUrl(baseUrl, BASE_ARTIFACT_PREFIX, version);
}
