import { ManifestSchema } from 'kiosk-types';
import { Logger } from '@/shared/logger/Logger';
import {
  APPLY_UPDATE_CONTROL,
  ROLLBACK_UPDATE_CONTROL,
  type UpdateCommand,
} from './types';

/**
 * 구독 payload 경계 파싱 — JSON 파싱 + 스키마 검증을 한곳에서 흡수한다.
 * onData 안에서 throw 하면 Apollo 파이프라인으로 새므로 여기서 막는다.
 *
 * 매니페스트 검증을 **여기서** 하는 이유: 형식이 틀린 지시를 큐에 담아두면 안전한 화면을
 * 기다렸다가 그때 실패한다. 받는 자리에서 거르면 그 지연이 없다.
 */
export function parseUpdateCommand(
  commandId: string,
  raw: string | null,
): UpdateCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '{}');
  } catch (error) {
    new Logger().error('[업데이트] 명령 payload 파싱 실패', error as Error);
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const payload = parsed as Record<string, unknown>;

  // 롤백은 목적지를 싣지 않는다 — 검증할 것이 없다.
  if (payload.controlType === ROLLBACK_UPDATE_CONTROL) {
    return { commandId, action: 'rollback' };
  }
  // 다른 controlType(원격 키 발급 등)은 이 어댑터 소관이 아니다.
  if (payload.controlType !== APPLY_UPDATE_CONTROL) return null;

  const manifest = ManifestSchema.safeParse(payload.manifest);
  if (!manifest.success) {
    new Logger().error(
      `[업데이트] 매니페스트 형식 오류 — 무시합니다 commandId=${commandId}`,
    );
    return null;
  }

  // 옛 경로에는 서버 배포 행이 없다 — 보고할 좌표도 없다.
  return {
    commandId,
    action: 'apply',
    manifest: manifest.data,
    deploymentIds: {},
  };
}
