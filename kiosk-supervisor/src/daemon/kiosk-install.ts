/**
 * 키오스크가 **교체되는 중인가** — 워치독이 죽이기 전에 묻는 질문.
 *
 * heartbeat 부재는 한 가지 사실이 아니다: 죽었을 수도, 지금 자기를 갈아치우는 중일 수도 있다.
 * 둘을 같게 취급하면 감시가 교체를 쏴 죽인다 — 설치 프로그램은 키오스크가 spawn 한 자식이라
 * 재기동 한 번이 설치를 반쯤 푼 채 끊는다(실측 2026-08-28: 여덟 번 연속 발화로 1.26.0 설치가
 * 깨져 수동 제거 후 재설치로만 복구됐다).
 *
 * **선언은 이미 디스크에 있다** — 키오스크가 설치본에 넘기기 전에 적용 기록을 `installing` 으로
 * 쓰고, 그 값의 뜻도 키오스크 스키마가 정의해 뒀다. 새 채널이 필요 없고 읽지 않고 있었을 뿐이다.
 * 읽기 전용이다 — 기록의 주인은 키오스크고, 여기서 쓰면 주인이 둘이 된다.
 */

import {
  KIOSK_APPLY_OUTCOME_INSTALLING,
  KIOSK_APPLY_RECORD_FILE,
  KIOSK_DATA_DIR_NAME,
  KIOSK_INSTALL_HOLD_MS,
  KIOSK_UPDATE_DIR_NAME,
  USER_PROFILES_DIR,
} from '../constants';
import { KioskApplyRecordSchema } from '../types';

/** `<프로필>\Kiosk\update\last-apply.json` */
export function applyRecordPath(username: string): string {
  return `${USER_PROFILES_DIR}\\${username}\\${KIOSK_DATA_DIR_NAME}\\${KIOSK_UPDATE_DIR_NAME}\\${KIOSK_APPLY_RECORD_FILE}`;
}

/**
 * 기록 원문에서 "지금 설치 중인 base 버전"을 읽는다. 아니면 null. 시각을 주입받는 순수 함수다.
 *
 * 앞선 시각(`at` 이 미래)도 유효로 본다 — 시계가 조금 어긋난 것을 "설치 중이 아니다"로 번역하면
 * 우리가 막으려던 바로 그 사고가 그대로 난다. 늦게 무장하는 쪽이 안전하다.
 */
export function readInstallingVersion(
  raw: string | null,
  now: number,
): string | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 반쯤 쓰인 기록 — 선언으로 읽지 않는다
  }

  const record = KioskApplyRecordSchema.safeParse(parsed);
  if (!record.success) return null;
  if (record.data.outcome !== KIOSK_APPLY_OUTCOME_INSTALLING) return null;

  const at = Date.parse(record.data.at);
  if (Number.isNaN(at)) return null;
  if (now - at >= KIOSK_INSTALL_HOLD_MS) return null; // 유예 만료 — 설치가 끝나지 못했다

  return record.data.requestedBase ?? 'unknown';
}

/**
 * 이 사용자의 키오스크가 설치 중이면 그 버전, 아니면 null. 사용자를 모르면(heartbeat 도 못 받고
 * 디스크 복원도 실패) null 이다 — 그 경우엔 재기동 수단도 표적을 모르는 `schtasks /end` 뿐이라
 * 설치를 찢을 손이 애초에 없다.
 */
export async function kioskInstallInProgress(
  username: string | null,
  now: number = Date.now(),
): Promise<string | null> {
  if (username === null) return null;
  const file = Bun.file(applyRecordPath(username));
  if (!(await file.exists())) return null;
  return readInstallingVersion(await file.text(), now);
}
