import {
  DEVICE_IDS,
  type DeviceId,
  HARDWARE_EVENTS,
} from '@/shared/constants/events/Hardware';
import { useAbortableEffect } from '@/shared/hooks/useAbortableEffect';
import { Logger } from '@/shared/logger/Logger';
import { Hardware } from '@/shared/transport/Hardware';

const MIN_BACKOFF_MS = 1_000;
/**
 * 재시도 간격의 상한.
 *
 * 이 루프는 실패한 기기를 성공할 때까지 **무한히** 다시 찔러본다. 그런데 미장착 기기가
 * 있으면(스캔 대상은 3종 고정) 그 실패는 영구라서, 상한이 짧을수록 영영 성공하지 않을
 * 스캔을 계속 돌린다. 백엔드 스캔은 미claimed 포트를 전부 열어보므로 무관한 포트 —
 * 특히 VAN 카드 단말 — 에까지 프로토콜 바이트가 매번 들어간다.
 *
 * 1초에서 2배씩 벌어져 5분에서 멈춘다(1→2→4→…→256초→5분). 초반의 촘촘한 재시도는
 * 그대로라 "부팅 직후 기기가 늦게 올라오는" 구간은 손해 보지 않는다.
 */
const MAX_BACKOFF_MS = 5 * 60_000;

function getBackoffMs(attempt: number): number {
  return Math.min(MIN_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

export function useHardwareScan(deviceIds: DeviceId[]) {
  useAbortableEffect((signal) => {
    const logger = new Logger();

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const scan = async (
      targets: DeviceId[],
      attempt: number,
    ): Promise<void> => {
      if (signal.aborted || targets.length === 0) return;

      try {
        const result = await new Hardware()
          .withTimeout(200_000)
          .request(HARDWARE_EVENTS.SCAN, targets);

        if (signal.aborted) return;

        const deviceNameMap: Record<DeviceId, string> = {
          [DEVICE_IDS.TOKEN_DISPENSER]: '토큰 디스펜서',
        };
        const toName = (id: DeviceId) => deviceNameMap[id];
        targets.forEach((deviceId) => {
          logger.info(
            `[기기점검] ${toName(deviceId)}: ${result[deviceId] ? '연결됨' : '연결 실패'}`,
          );
        });

        const failedDevices = targets.filter((id) => !result[id]);

        if (failedDevices.length > 0 && !signal.aborted) {
          const delay = getBackoffMs(attempt);
          logger.info(
            `[기기점검] 실패 기기 재시도: ${failedDevices.map(toName).join(', ')} (${delay / 1000}초 후)`,
          );
          await sleep(delay);
          return scan(failedDevices, attempt + 1);
        }
      } catch (error) {
        if (signal.aborted) return;

        const delay = getBackoffMs(attempt);
        logger.error(
          `[기기점검] 에러 발생, 이전 시도 기기 재시도: ${targets.join(', ')} (${delay / 1000}초 후)`,
          error instanceof Error ? error : new Error(String(error)),
        );
        await sleep(delay);
        return scan(targets, attempt + 1);
      }
    };

    scan(deviceIds, 0);
  }, []);
}
