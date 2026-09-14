/**
 * 실재와 지시를 사람이 봐야 할 것으로 접는 판정 — **순수 함수만.**
 *
 * 서버는 목표와 실재를 비교하지 않는다(키오스크가 판정해 보고한다). 그래서 콘솔이 하는
 * 판정은 둘뿐이다: **결론이 실패인가**, 그리고 **결론이 아예 안 오는가.** 후자를 시간으로
 * 가르는 이유는 침묵이 별도 상태로 오지 않기 때문이다 — `SENT` 에 오래 머무는 것이 곧
 * 침묵이다.
 */

import type { Deployment, EntityVersion } from './types';

/**
 * 이 시간을 넘겨 `SENT` 면 미적용으로 본다.
 *
 * 적용은 홈 진입 드레인이라 손님이 쓰는 중이면 늦어진다 — 한 손님 세션보다 넉넉해야
 * 정상 지연을 실패로 오인하지 않는다.
 */
export const STALE_SENT_MS = 30 * 60 * 1000;

/**
 * 이 시간 동안 버전 보고가 없으면 침묵으로 본다.
 *
 * 보고는 부팅 완주마다 오므로 하루가 비면 앱이 안 돌거나 보고가 없는 옛 버전이다.
 */
export const SILENT_MS = 24 * 60 * 60 * 1000;

export type KioskHealth = {
  /** 결론이 실패로 난 지시 수. */
  failed: number;
  /** `SENT` 에 오래 머문 지시 수 — 지시는 갔는데 결론이 없다. */
  pending: number;
  /** 버전 보고가 없거나 오래됐다. */
  silent: boolean;
};

export const HEALTHY: KioskHealth = { failed: 0, pending: 0, silent: false };

const isStale = (deployment: Deployment, nowMs: number): boolean =>
  deployment.status === 'SENT' && nowMs - deployment.updatedAt > STALE_SENT_MS;

/** 가장 최근 보고 시각 — 도메인마다 따로 오므로 그중 제일 새것이 이 기기의 생존 신호다. */
export const lastReportOf = (versions: readonly EntityVersion[]): number =>
  versions.reduce((latest, v) => Math.max(latest, v.reportedAt), 0);

/**
 * 보고가 하나도 없는 키오스크도 침묵이다 — 한 번도 말한 적 없다는 뜻이지 정상이 아니다.
 * 여기서 정상으로 접으면 새로 설치된 기기가 조용히 초록으로 뜬다.
 */
export function healthOf(
  versions: readonly EntityVersion[],
  deployments: readonly Deployment[],
  nowMs: number,
): KioskHealth {
  const latest = lastReportOf(versions);
  return {
    failed: deployments.filter((d) => d.status === 'FAILED').length,
    pending: deployments.filter((d) => isStale(d, nowMs)).length,
    silent: latest === 0 || nowMs - latest > SILENT_MS,
  };
}

/** 사람이 손대야 하는가 — 실패했거나 결론이 안 온다. */
export const isTroubled = (health: KioskHealth): boolean =>
  health.failed > 0 || health.pending > 0;

/** 대상 열의 칩. 닫힌 집합이라 새 칩은 여기 등록해야 화면에 뜬다. */
export const TARGET_FILTER = {
  ALL: 'all',
  CONNECTED: 'connected',
  OFFLINE: 'offline',
  TROUBLE: 'trouble',
  SILENT: 'silent',
} as const;

export type TargetFilter = (typeof TARGET_FILTER)[keyof typeof TARGET_FILTER];

export const TARGET_FILTER_LABEL: Record<TargetFilter, string> = {
  all: '전체',
  connected: '연결',
  offline: '끊김',
  trouble: '이상',
  silent: '미보고',
};

/**
 * 칩마다의 술어. switch 가 아니라 레코드인 이유는 **닫힌 집합을 타입이 지키게** 하기
 * 위해서다 — 칩을 늘리고 여기를 빼먹으면 컴파일이 막는다. default 절은 그 검사를 무력화한다.
 */
const MATCHES: Record<
  TargetFilter,
  (connectionState: string, health: KioskHealth) => boolean
> = {
  all: () => true,
  connected: (connectionState) => connectionState === 'connected',
  offline: (connectionState) => connectionState !== 'connected',
  trouble: (_, health) => isTroubled(health),
  silent: (_, health) => health.silent,
};

export const matchesTargetFilter = (
  filter: TargetFilter,
  connectionState: string,
  health: KioskHealth,
): boolean => MATCHES[filter](connectionState, health);

/**
 * 행에 마우스를 올렸을 때 보여줄 조합 — 도메인별 실재 한 덩어리.
 *
 * 촘촘한 행에 도메인 열을 늘어놓으면 수백 대에서 아무도 못 읽는다. 요약은 배지가 지고
 * 전문은 여기가 진다. 손댈 것이 있으면 그것도 함께 — 툴팁만 보고도 판단이 서야 한다.
 */
export function describeState(
  versions: readonly EntityVersion[],
  deployments: readonly Deployment[],
): string {
  if (versions.length === 0 && deployments.length === 0) {
    return '보고 없음';
  }
  const lines = versions
    .filter((v) => v.removedAt === null)
    .map((v) => `${v.domain} ${v.version}`);
  if (lines.length === 0) lines.push('보고된 버전 없음');

  for (const deployment of deployments) {
    const mark = deployment.status === 'FAILED' ? '✕' : '…';
    lines.push(
      `${mark} ${deployment.domain} → ${deployment.version}${
        deployment.errorMessage ? ` (${deployment.errorMessage})` : ''
      }`,
    );
  }
  return lines.join('\n');
}
