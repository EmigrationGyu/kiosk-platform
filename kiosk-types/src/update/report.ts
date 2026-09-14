import { z } from 'zod';
import {
  APPLY_OUTCOME,
  type ApplyRecord,
  ApplyRecordSchema,
} from './applyRecord';
import type { UpdateComponent } from './components';
import { BASE_DOMAIN } from './deployment';
import {
  BASELINE_GENERATION,
  type GenerationMap,
  GenerationMapSchema,
  type Pointer,
} from './generation';
import {
  RollbackEntrySchema,
  type RollbackStack,
  topRollback,
} from './rollbackStack';

/**
 * 키오스크 → 서버 보고 — 페이로드의 단일 출처. 서버는 이 둘을 JSON 한 덩어리로 받아 저장하고
 * 도메인별 행은 거기서 파생한다(조합 정보는 이 덩어리에만 있다 — 행으로 쪼개는 순간 사라진다).
 *
 * 둘로 나뉜 이유: 상태는 "지금 무엇이 도는가"라 홈 진입마다, 결과는 "지시 X 가 어떻게 끝났는가"라
 * 지시당 한 번이다. 서버 테이블도 그렇게 갈린다.
 */
export const SoftwareStateReportSchema = z.object({
  reportVersion: z.literal(1),
  /** 앱 설치본 버전. */
  appVersion: z.string().min(1),
  /** 지금 도는 조합. 빠짐 = baseline. */
  live: GenerationMapSchema,
  /**
   * 설치본에 동봉된 사본들의 실제 버전 — **포인터가 아니다.**
   *
   * `live` 에서 빠졌다는 것은 "갱신된 적 없다"는 뜻이지 "무엇이 도는지 모른다"가 아니다. 서버에
   * `baseline` 이라는 문자열은 실을 수 없으므로(버전이 아니라 표시다) 실제 값을 따로 담는다.
   * `live` 에 합치지 않는 이유: "빠짐 = baseline" 은 적용·롤백이 기대는 규약이다.
   * 못 읽으면 그 컴포넌트만 빠진다 — 읽기 실패가 보고 전체를 막지 않는다.
   */
  baselineVersions: GenerationMapSchema.default({}),
  /** 마지막으로 검증된 조합 — 자동 되감기 목적지. */
  stable: GenerationMapSchema,
  /** 운영자 롤백이 갈 곳. 없으면 롤백은 거절된다. */
  rollbackTop: RollbackEntrySchema.nullable(),
  /** 마지막 적용 기록 그대로 — commandId 로 서버 행과 맞댄다. */
  lastApply: ApplyRecordSchema.nullable(),
  at: z.string(),
});

export type SoftwareStateReport = z.infer<typeof SoftwareStateReportSchema>;

/** 서버 `Deployment.status` 로 가는 결론 — 소프트웨어가 답했는지만 가른다. */
export const REPORT_STATUS = {
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  /** 설치본에 넘긴 채 — 다시 뜬 앱이 정산하기 전. 서버는 SENT 를 유지한다. */
  PENDING: 'PENDING',
} as const;

export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];

export const ApplyResultReportSchema = z.object({
  reportVersion: z.literal(1),
  /** 서버 알림 id. 하네스 지시(null)는 서버가 맞댈 행이 없다. */
  commandId: z.string().nullable(),
  status: z.enum(REPORT_STATUS),
  outcome: z.enum(APPLY_OUTCOME),
  /** 사람이 읽는 사유 — 서버 `errorMessage`. */
  cause: z.string(),
  /** 결론이 난 뒤 실제로 도는 조합 — 서버가 `version` 을 이 값으로 덮는다. */
  applied: GenerationMapSchema,
  appVersion: z.string().min(1),
  at: z.string(),
});

export type ApplyResultReport = z.infer<typeof ApplyResultReportSchema>;

/**
 * outcome → 서버 status. 적용만 완료. 거절도 실패다 — 운영자가 시킨 일이 일어나지
 * 않았다는 점에서 되감김과 같고, 사유는 `cause` 가 든다. installing 은 아직.
 */
export function statusOf(outcome: ApplyRecord['outcome']): ReportStatus {
  switch (outcome) {
    case APPLY_OUTCOME.APPLIED:
    // 원한 상태가 이미 참이면 시킨 일은 일어난 것이다 — 서버도 그렇게 닫는다.
    case APPLY_OUTCOME.UNCHANGED:
      return REPORT_STATUS.COMPLETED;
    case APPLY_OUTCOME.INSTALLING:
      return REPORT_STATUS.PENDING;
    default:
      return REPORT_STATUS.FAILED;
  }
}

export function buildSoftwareStateReport(input: {
  appVersion: string;
  live: Pointer;
  /** 동봉본의 실제 버전. 못 읽은 것은 빠진다. */
  baselineVersions?: GenerationMap;
  stable: Pointer;
  stack: RollbackStack;
  lastApply: ApplyRecord | null;
  now: string;
}): SoftwareStateReport {
  return {
    reportVersion: 1,
    appVersion: input.appVersion,
    live: input.live.components,
    baselineVersions: input.baselineVersions ?? {},
    stable: input.stable.components,
    rollbackTop: topRollback(input.stack),
    lastApply: input.lastApply,
    at: input.now,
  };
}

/**
 * 미보고 기록을 결과 보고로. 이미 보고했거나 기록이 없으면 null. `applied` 는 기록이 아니라
 * **지금 live** 다 — 되감김이 어디까지 갔는지는 기록의 rolledBackTo 보다 포인터가 정확하다.
 */
export function buildApplyResultReport(input: {
  record: ApplyRecord | null;
  live: Pointer;
  appVersion: string;
  now: string;
}): ApplyResultReport | null {
  const { record } = input;
  if (record === null || record.reported) return null;
  return {
    reportVersion: 1,
    commandId: record.commandId,
    status: statusOf(record.outcome),
    outcome: record.outcome,
    cause: record.detail,
    applied: input.live.components,
    appVersion: input.appVersion,
    at: input.now,
  };
}

// ── 서버(PMS) 두 축으로의 변환 ──
// 서버는 축을 둘로 갈라 든다: `EntityVersion` 은 **키오스크가 돈다고 말한 것**, `Deployment` 는
// **서버가 시킨 것과 그 결말**이다. 한 값이 두 뜻을 지면(옛 `deployments.version`) 읽는 쪽이
// 둘을 봉합하게 되므로 보고도 둘로 나간다.

/** `reportKioskVersions` 의 한 항목. */
export type ReportedComponentVersion = {
  domain: string;
  version: string;
  previousVersion?: string;
};

export type VersionReport = {
  reportedAt: string;
  components: ReportedComponentVersion[];
};

/**
 * 상태 보고 → `reportKioskVersions` 입력.
 *
 * **`baseline` 은 보고하지 않는다.** 서버의 version 은 semver 만 받는데 `baseline` 은 버전이 아니라
 * "설치본에 동봉된 것"이라는 표시라 실을 수가 없다. 포인터에서 빠진 컴포넌트도 같은 뜻이므로 둘 다
 * 뺀다 — 즉 **목록에 없다 = 설치본 그대로**이지 "모른다"가 아니다.
 *
 * 앱 설치본은 `base` 도메인으로 싣는다(서버는 도메인을 문자열로만 보므로 이름 하나를 예약해 두 축을
 * 한 목록에 담는다). `previousVersion` 은 되돌림 스택 top — 그것이 곧 밀려난 직전 조합이다.
 */
export function toVersionReport(state: SoftwareStateReport): VersionReport {
  const previous = state.rollbackTop;
  const named = (version: string | undefined): string | undefined =>
    version && version !== BASELINE_GENERATION ? version : undefined;

  const components: ReportedComponentVersion[] = [
    {
      domain: BASE_DOMAIN,
      version: state.appVersion,
      ...(previous?.base ? { previousVersion: previous.base } : {}),
    },
  ];

  // 갱신된 세대가 있으면 그것이, 없으면 동봉본의 실제 버전이 "지금 도는 것"이다.
  // 둘 다 없으면 뺀다 — 못 읽었다는 뜻이고, 없는 값을 지어내지 않는다.
  const domains = new Set([
    ...Object.keys(state.live),
    ...Object.keys(state.baselineVersions),
  ]);

  for (const domain of domains) {
    const component = domain as UpdateComponent;
    const running =
      named(state.live[component]) ?? named(state.baselineVersions[component]);
    if (!running) continue;
    const before = named(previous?.components?.[component]);
    components.push({
      domain,
      version: running,
      ...(before ? { previousVersion: before } : {}),
    });
  }

  return { reportedAt: state.at, components };
}

/** `reportDeploymentResult` 의 한 건. */
export type DeploymentResultReport = {
  deploymentId: string;
  status: 'COMPLETED' | 'FAILED';
  errorMessage?: string;
};

/**
 * 결과 보고 → `reportDeploymentResult` N 건. 적용은 조합 단위라 결론이 하나인데 서버는 행 단위로
 * 받으므로 **같은 결론을 행 수만큼** 펼친다 — 조합은 통째로 서거나 통째로 되감기므로 행마다
 * 갈릴 일이 없다. `installing` 은 아무것도 내보내지 않는다(아직 결말이 아니고 서버도 `SENT`
 * 유지를 기대한다).
 */
export function toResultReports(
  result: ApplyResultReport,
  ids: Readonly<Record<string, string>>,
): DeploymentResultReport[] {
  if (result.status === REPORT_STATUS.PENDING) return [];
  const status = result.status;
  return Object.values(ids).map((deploymentId) => ({
    deploymentId,
    status,
    ...(status === REPORT_STATUS.FAILED && result.cause
      ? { errorMessage: result.cause }
      : {}),
  }));
}
