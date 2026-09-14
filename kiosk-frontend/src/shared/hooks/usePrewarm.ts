import { useEffect } from 'react';
import {
  HARDWARE_EVENTS,
  type WarmableProcess,
} from '@/shared/constants/events/Hardware';
import { Logger } from '@/shared/logger/Logger';
import { Hardware } from '@/shared/transport/Hardware';

// 스캐너 디바이스는 워밍이 재스캔(포트별 핸드셰이크)까지 갈 수 있어 넉넉히 잡는다.
const PREWARM_TIMEOUT_MS = 30_000;

/**
 * 플로우 진입 시 lazy-spawn 서브프로세스를 미리 깨운다(fire-and-forget).
 *
 * 첫 하드웨어 요청이 치르는 콜드 스타트 비용(utilityProcess fork → 포트 스캔 →
 * PORT_ASSIGNED → 디바이스 init)을 사용자가 해당 단계에 도달하기 전에 앞당겨 치른다.
 * 실패해도 무시한다 — 실제 요청 경로의 @EnsureDevice 복구가 정합성을 책임지므로
 * 프리웜은 순수한 레이턴시 최적화다. 진입 후 이탈해도 idle reaper 가 회수한다.
 *
 * `rewarmKey` 를 주면 키가 바뀔 때마다 재발화한다(keep-warm). 이미 떠있는 프로세스에는
 * healthCheck 왕복 1번 = idle reaper 의 5분 타이머 리셋이라, 라우트 pathname 등을 키로
 * 걸면 플로우 체류 내내 warm 이 유지된다.
 */
export function usePrewarm(
  processes: readonly WarmableProcess[],
  rewarmKey?: unknown,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: processes 는 상수 배열 — rewarmKey 변화에만 재발화한다.
  useEffect(() => {
    const logger = new Logger();
    new Hardware()
      .withTimeout(PREWARM_TIMEOUT_MS)
      .request(HARDWARE_EVENTS.WARMUP, [...processes])
      .then((result) => {
        const cold = processes.filter((process) => !result[process]);
        if (cold.length > 0) {
          logger.info(`[프리웜] 워밍 실패(무시): ${cold.join(', ')}`);
        }
      })
      .catch(() => {
        // 프리웜 실패는 무시 — 실요청 경로가 스스로 복구한다.
      });
    // rewarmKey 미지정 시 마운트 1회만 발화한다 (useHardwareScan 과 동일 idiom).
  }, [rewarmKey]);
}
