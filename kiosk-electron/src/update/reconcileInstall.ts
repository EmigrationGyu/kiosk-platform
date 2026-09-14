import {
  APPLY_OUTCOME,
  type ApplyRecord,
} from 'kiosk-types/src/update/applyRecord';

/**
 * 설치를 넘긴 기록을 정산한다 — **다시 뜬 앱만이 답을 안다.** 넘긴 쪽은 결과를 볼 수 없어
 * 기록이 `installing` 에 머무는데, 그대로 두면 성공한 설치가 서버에 "끝나지 못함"으로 보고된다.
 *
 * 어긋나면 **손대지 않는다** — 그 값에 머물러 있는 것 자체가 "끝나지 못했다"는 뜻이라 실패를
 * 위한 결과 종류가 따로 필요 없다. 쓸 것이 없으면 null(매 부팅 같은 파일을 다시 쓰지 않는다).
 */
export function reconcileInstall(
  record: ApplyRecord | null,
  appVersion: string,
): ApplyRecord | null {
  if (record?.outcome !== APPLY_OUTCOME.INSTALLING) return null;
  if (record.requestedBase !== appVersion) return null;

  return {
    ...record,
    outcome: APPLY_OUTCOME.APPLIED,
    detail: `설치 완료: ${appVersion}`,
  };
}
