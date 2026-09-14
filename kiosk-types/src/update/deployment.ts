import { z } from 'zod';
import { type Manifest, ManifestSchema } from './generation';

/**
 * 서버(PMS) 배포 지시 — 알림과 폴링이 **같은 모양**으로 온다.
 *
 * 서버는 (키오스크, 도메인)마다 행 하나를 만들고 한 발송을 `batchId` 로 묶는다. 키오스크는 조합을
 * 통째로 적용하므로 받는 즉시 행 묶음을 매니페스트 하나로 접는다 — 그 접는 규칙이 이 파일이다.
 * 행을 다시 펼 수 있어야 **보고**가 되므로 `domain → deploymentId` 를 함께 돌려준다.
 */

/** `KioskSystemNotification.type` — 원격 키 발급이 쓰는 `KIOSK_CONTROL` 과 별개 채널이다. */
export const DEPLOYMENT_NOTIFICATION_TYPE = 'DEPLOYMENT';

/**
 * 앱 설치본이 실려 오는 도메인 이름. 서버는 도메인 집합을 강제하지 않으므로(문자열이다), 설치본이
 * 컴포넌트와 다른 축임을 표시하려고 이름 하나를 예약한다.
 */
export const BASE_DOMAIN = 'base';

/** 서버 `Deployment` 행 중 키오스크가 쓰는 부분. */
export const DeploymentRowSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  version: z.string().min(1),
  /** 서버가 아는 직전 버전. 적용에는 쓰지 않는다 — 진단·표시용. */
  previousVersion: z.string().nullable().optional(),
});

export type DeploymentRow = z.infer<typeof DeploymentRowSchema>;

/** 알림 payload. `pendingDeployments` 로 당겨온 행들도 batchId 로 묶어 이 모양이 된다. */
export const DeploymentCommandSchema = z.object({
  batchId: z.string().min(1),
  deployments: z.array(DeploymentRowSchema).min(1),
});

export type DeploymentCommand = z.infer<typeof DeploymentCommandSchema>;

/** 도메인 → 서버 행 id. 결과를 행 단위로 되돌려보낼 때의 좌표. */
export type DeploymentIdMap = Readonly<Record<string, string>>;

/**
 * 접은 결과. **거절도 맵을 들고 나온다** — 거절은 "시킨 일이 일어나지 않았다"는 결론이라 서버에
 * 보고해야 하고, 보고하려면 어느 행이었는지가 필요하다. 조용히 버리면 그 행들은 서버에서 영원히
 * `SENT` 로 남는다.
 */
export type NormalizedDeployment =
  | { ok: true; manifest: Manifest; ids: DeploymentIdMap }
  | { ok: false; reason: string; ids: DeploymentIdMap };

const idsOf = (rows: readonly DeploymentRow[]): DeploymentIdMap =>
  Object.fromEntries(rows.map((row) => [row.domain, row.id]));

/**
 * 행 묶음 → 매니페스트. 설치본과 컴포넌트가 섞여 오면 거절한다 — 서버는 이 조합을 막지 않지만
 * (도메인이 그냥 문자열이다) 설치가 세대를 전부 새로 놓으므로 함께 적용할 수 없다. 여기서 먼저
 * 걸러야 사유를 행 단위로 보고할 수 있다.
 */
export function normalizeDeployment(
  rows: readonly DeploymentRow[],
): NormalizedDeployment {
  const ids = idsOf(rows);

  if (rows.length === 0) {
    return { ok: false, reason: '빈 배포 지시', ids };
  }
  // 같은 도메인이 두 번 오면 나중 것이 앞의 것을 덮어 조용히 하나가 사라진다.
  if (Object.keys(ids).length !== rows.length) {
    return { ok: false, reason: '같은 도메인이 두 번 실려 있습니다', ids };
  }

  const base = rows.find((row) => row.domain === BASE_DOMAIN);
  const components = rows.filter((row) => row.domain !== BASE_DOMAIN);

  if (base && components.length > 0) {
    return {
      ok: false,
      reason:
        '설치본과 컴포넌트를 함께 받을 수 없습니다 — 설치가 세대를 전부 새로 놓습니다',
      ids,
    };
  }

  // 접은 결과를 스키마에 한 번 더 통과시킨다 — 매니페스트의 불변식은 그쪽이 소유한다.
  const manifest = ManifestSchema.safeParse(
    base
      ? { manifestVersion: 1, base: base.version }
      : {
          manifestVersion: 1,
          components: Object.fromEntries(
            components.map((row) => [row.domain, row.version]),
          ),
        },
  );

  return manifest.success
    ? { ok: true, manifest: manifest.data, ids }
    : { ok: false, reason: '매니페스트 형식 오류', ids };
}

/**
 * 폴링으로 당겨온 행들을 발송 단위로 나눈다 — 서로 다른 배치가 한 매니페스트로 섞이면 안 된다
 * (각각이 독립적으로 승격·보고되는 단위다). 서버가 오래된 것부터 주므로 순서는 그대로 지킨다.
 */
export function groupByBatch(
  rows: readonly (DeploymentRow & { batchId: string })[],
): DeploymentCommand[] {
  const byBatch = new Map<string, DeploymentRow[]>();
  for (const { batchId, ...row } of rows) {
    const found = byBatch.get(batchId);
    if (found) found.push(row);
    else byBatch.set(batchId, [row]);
  }
  return [...byBatch.entries()].map(([batchId, deployments]) => ({
    batchId,
    deployments,
  }));
}
