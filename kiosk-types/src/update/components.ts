import type { SerialportProcess } from '../serialport/processes';

/**
 * 원격 부분 업데이트로 **교체 가능한 아티팩트**(컴포넌트)의 식별자와 디스크 레이아웃 — 단일 출처.
 *
 * 이 경로 지식은 electron 메인(렌더러 로드)·backend(서브프로세스 spawn)·빌드 스크립트에 각자
 * 흩어져 있었다. 컴포넌트 단위로 사본을 갈아끼우려면 "그게 어디 있나"에 답하는 곳이 하나여야 한다.
 * types 는 환경을 모르므로(브라우저 번들에도 들어간다) 세그먼트만 돌려주고 결합은 호출부가 한다.
 */

/** 패키지 안에서 교체 대상 아티팩트들이 모여 있는 디렉토리 이름 (asar 밖). */
export const ARTIFACT_ROOT_DIR = 'target';

/** serialport 서브프로세스가 아닌 컴포넌트. */
export const UPDATE_COMPONENT = {
  BACKEND: 'backend',
  FRONTEND: 'frontend',
} as const;

export type UpdateComponent =
  | (typeof UPDATE_COMPONENT)[keyof typeof UPDATE_COMPONENT]
  | SerialportProcess;

const NON_SERIALPORT: readonly string[] = Object.values(UPDATE_COMPONENT);

/**
 * 아티팩트 루트 기준 상대 경로 세그먼트.
 * backend/frontend 는 루트 바로 아래, serialport 는 `serialport/{process}` 아래에 있다.
 */
export function componentSegments(component: UpdateComponent): string[] {
  return NON_SERIALPORT.includes(component)
    ? [component]
    : ['serialport', component];
}

/**
 * S3 에 올라간 이 컴포넌트의 prefix.
 *
 * **출처는 각 패키지의 `package.json` name 이다** — CI 가 그 값을 그대로 prefix 로 쓰고
 * (`s3://{bucket}/{name}/{version}/`) electron 패키징도 같은 경로에서 내려받는다. 이름 규칙으로
 * 조립하면 안 된다: 프론트는 `kiosk-frontend` 라 규칙이 어긋났고, 그 상태로 올라간
 * 산출물을 키오스크가 404 로 못 찾았다(실측). 둘이 갈리면 `components.test.ts` 가 잡는다.
 */
const NON_SERIALPORT_PREFIX: Record<string, string> = {
  [UPDATE_COMPONENT.BACKEND]: 'kiosk-backend',
  [UPDATE_COMPONENT.FRONTEND]: 'kiosk-frontend',
};

export function artifactPrefix(component: UpdateComponent): string {
  return NON_SERIALPORT_PREFIX[component] ?? component;
}

/**
 * 앱 껍데기(설치본)가 올라가는 S3 prefix. `artifactPrefix` 와 따로 두는 이유: base 는
 * `UpdateComponent` 가 아니다 — 세대로 갈아끼우는 것이 아니라 전부를 갈아치우는 다른 축이다.
 */
export const BASE_ARTIFACT_PREFIX = 'kiosk-electron';

/**
 * 단말 로컬 데이터 루트의 이름 — 사용자 홈 아래. 로그·자산·업데이트 기록이 모두 이 아래 있다.
 * 경로 결합은 호출부가 한다(types 는 환경을 모른다).
 *
 * 설치 위치가 아니라 **홈 아래**인 이유: 설치본은 업데이트가 디렉토리를 통째로 갈아치우므로,
 * 거기 둔 것은 남겨야 할 바로 그 순간에 사라진다. 계정별로 갈리는 것도 의도다.
 */
export const LOCAL_DATA_DIR = '.kiosk';

/**
 * 업데이트 작업 디렉토리 — 받아둔 설치본과 적용 기록이 놓인다. `ARTIFACT_ROOT_DIR` 이 아닌 이유:
 * 설치본이 그 디렉토리를 통째로 갈아치우므로, 거기 둔 기록은 결과를 남겨야 할 바로 그 순간에 사라진다.
 */
export const LOCAL_UPDATE_DIR = 'update';
