/**
 * 빠른 종료의 연속을 세어 "재기동으로 풀릴 문제"와 "세대 문제"를 가른다. 준비 선언 워치독이
 * 못 보는 두 모양을 받는다 — **선언 후 크래시 루프**(매 세대가 구독까지 가서 워치독이 매번
 * 해제된다) · **콜드 부팅 즉사 루프**(respawn 마다 재무장되어 타이머가 영영 안 끝난다).
 *
 * 리셋 근거는 선언이 아니라 **수명**이다: 선언은 크래시 루프도 매 사이클 하므로 근거가 못 되고,
 * 죽기 전에 충분히 살았다는 사실만이 "세대는 멀쩡했다"를 증언한다. 시각은 주입받는다.
 */
export type CrashVerdict = 'restart' | 'escalate';

export type CrashEscalator = {
  /** 백엔드가 떴다 — 기동 시각을 기록한다. */
  started(now: number): void;
  /** 예기치 않게 죽었다 — 재기동으로 충분한지, 사다리를 내려가야 하는지. */
  exited(now: number): CrashVerdict;
};

export function createCrashEscalator(deps: {
  /** 이보다 짧게 살고 죽으면 "빠른 종료"로 센다. */
  fastDeathMs: number;
  /** 빠른 종료가 연속 몇 번이면 세대 문제로 볼 것인가. */
  threshold: number;
}): CrashEscalator {
  let startedAt: number | null = null;
  let consecutive = 0;

  return {
    started(now) {
      startedAt = now;
    },

    exited(now) {
      // 기동 시각을 모르는 죽음(스폰 이벤트 전 사망)은 가장 빠른 종료다 — 빠른 쪽으로 센다.
      const lived = startedAt === null ? 0 : now - startedAt;
      startedAt = null;

      if (lived >= deps.fastDeathMs) {
        // 충분히 살았다 — 이 죽음은 런타임 사고지 산출물 문제가 아니다. 새로 센다.
        consecutive = 1;
        return 'restart';
      }

      consecutive += 1;
      if (consecutive < deps.threshold) return 'restart';
      // 사다리를 내려간다 — 다음 세대에서 다시 셀 수 있도록 비운다.
      consecutive = 0;
      return 'escalate';
    },
  };
}
