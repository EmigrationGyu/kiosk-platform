import type { Namespace } from '../namespaces';
import type { SerialportProcess } from '../serialport/processes';
import { CONTRACT } from './generated';

/**
 * 각 번들이 **자기가 어느 계약으로 빌드됐는지** 신고하는 창구. 값은 빌드 시 주입이 아니라 생성된
 * 상수 모듈에서 온다 — 모든 번들이 자기 types 사본을 품고 있으므로 번들 안의 이 상수가 곧 "그
 * 번들이 빌드된 계약"이다(번들러 설정 불필요, bun test·tsc 에서도 동일). 지문이 다르다는 것은
 * 함께 배포됐어야 할 컴포넌트가 갈렸다는 신호다.
 */
export const CONTRACT_TOTAL: string = CONTRACT.total;

/**
 * 프론트엔드 ↔ 백엔드 관계 전체의 합성 지문 — 렌더러가 생존·완주 선언에 싣는 값. total 이 아니라
 * 이 값으로 대조하는 이유: 장치 스키마만 움직인 변경에서 프론트는 무관한 이해관계자다. 판정은
 * **말이 오가는 표면**에만 걸어야 부분 배포가 성립한다.
 */
export const FRONTEND_BACKEND_CONTRACT: string = CONTRACT.frontendBackend;

export const namespaceContractHash = (namespace: Namespace): string =>
  CONTRACT.namespaces[namespace];

export const processContractHash = (process: SerialportProcess): string =>
  CONTRACT.processes[process];

/**
 * 관측자(백엔드)가 상대별로 기대하는 표면 지문 — 일치 판정의 단일 출처. 키오스크의 witness 와
 * 콘솔의 조합 제안이 **같은 규칙**을 봐야 하므로 여기 한 곳에 둔다 — 두 벌이면 콘솔이 배포
 * 가능하다 한 조합을 키오스크가 되감는다.
 */
export const surfaceContractOf = (
  party: 'frontend' | SerialportProcess,
): string =>
  party === 'frontend' ? CONTRACT.frontendBackend : CONTRACT.processes[party];

/** 로그 한 줄용 축약 — 전체 지문 앞 12자리. 육안 비교에 충분하다. */
export const shortHash = (hash: string): string => hash.slice(0, 12);

/** 부팅 로그용 요약. */
export const contractSummary = (): string =>
  `total=${shortHash(CONTRACT.total)}`;
