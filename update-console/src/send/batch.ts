import type { ManifestBody } from '../api';
import type { Result, Status } from '../dispatch';
import type { Deployment, DeploymentComponent } from '../fleet';
import { BASE_DOMAIN } from '../fleet';

/**
 * 발송 한 건을 화면이 읽는 모양으로.
 *
 * 서버는 (키오스크, 도메인)마다 행을 만들지만 사람이 보는 단위는 **기기**다. 도메인 열을
 * 결과 열에까지 늘어놓으면 수백 대에서 못 읽는다 — 전문은 「버전 현황」 판이 진다.
 */

/** 매니페스트 → 서버가 받는 컴포넌트 목록. 두 축이 한 목록으로 합쳐진다. */
export function toComponents(
  manifest: ManifestBody,
): readonly DeploymentComponent[] {
  return 'base' in manifest
    ? [{ domain: BASE_DOMAIN, version: manifest.base }]
    : Object.entries(manifest.components).map(([domain, version]) => ({
        domain,
        version,
      }));
}

/**
 * 기기 하나의 결말 — **나쁜 소식이 이긴다.**
 *
 * 한 기기에 도메인이 여럿이고 조합은 통째로 적용되므로 보통 다 같은 값이지만, 덮어쓰기
 * (CANCELED)나 부분 보고로 갈릴 수 있다. 그때 "하나라도 실패면 실패"가 아니면 손댈 곳이
 * 초록으로 묻힌다.
 */
function statusOf(rows: readonly Deployment[]): Status {
  if (rows.some((row) => row.status === 'FAILED')) return 'failed';
  // 덮어쓴 지시는 이 발송이 끝까지 가지 못했다는 뜻이다 — 성공으로 셀 수 없다.
  if (rows.some((row) => row.status === 'CANCELED')) return 'failed';
  if (rows.some((row) => row.status === 'SENT')) return 'sending';
  return 'ok';
}

const reasonOf = (rows: readonly Deployment[]): string | undefined =>
  rows.find((row) => row.errorMessage)?.errorMessage ??
  (rows.some((row) => row.status === 'CANCELED')
    ? '더 새 지시가 덮었습니다'
    : undefined);

/** 행들을 기기 단위로 접는다. 순서는 손댈 것이 위로 오게 결과 열이 다시 정한다. */
export function summarizeBatch(deployments: readonly Deployment[]): Result[] {
  const byKiosk = new Map<string, Deployment[]>();
  for (const deployment of deployments) {
    const found = byKiosk.get(deployment.kioskId);
    if (found) found.push(deployment);
    else byKiosk.set(deployment.kioskId, [deployment]);
  }

  return [...byKiosk.entries()].map(([id, rows]) => {
    const status = statusOf(rows);
    const error = status === 'failed' ? reasonOf(rows) : undefined;
    return { id, status, ...(error ? { error } : {}) };
  });
}

/**
 * 다시 보낼 대상 — **끝나지 않은 것 전부**다.
 *
 * "실패한 것만"이 아니다. 결론이 안 온 기기(`SENT` 로 머문 것)도 다시 보내야 하는데,
 * 새 지시가 옛 것을 덮으므로(서버가 supersede 한다) 두 번 적용되지 않는다.
 */
export const unfinishedKiosks = (
  deployments: readonly Deployment[],
): string[] =>
  summarizeBatch(deployments)
    .filter((result) => result.status !== 'ok')
    .map((result) => result.id);

/**
 * 부분 실패한 발송의 id 를 건져낸다.
 *
 * 대상이 100 대를 넘으면 서버가 청크로 끊어 커밋한다. 중간 청크가 실패하면 앞 청크는
 * **이미 나갔고**, 서버는 그 사실을 숨기지 않고 batchId 를 메시지에 담아 던진다
 * (`DEPLOYMENT_BATCH_PARTIAL`). 그 id 가 없으면 화면은 "실패했다"만 말하고, 이미 나간
 * 지시들은 아무도 못 보고 못 닫는다.
 *
 * 메시지 문자열에 기대는 것은 약한 결합이지만, 지금 경계를 넘어오는 것이 그것뿐이다.
 * 못 찾으면 null 이고 그때는 예전처럼 에러만 뜬다 — 틀린 id 를 지어내지 않는다.
 */
export function recoverBatchId(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  // ULID: Crockford base32, 26자.
  const found = message.match(/batch\s+([0-9A-HJKMNP-TV-Z]{26})/);
  return found?.[1] ?? null;
}
