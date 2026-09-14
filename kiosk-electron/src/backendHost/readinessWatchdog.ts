/**
 * 백엔드가 "준비됐다"고 선언하기를 기다리는 감시자.
 *
 * 배선을 사실 기반으로 바꾼 대가로 **영원히 준비되지 않는 상태**가 설계상 가능해졌다. 죽으면
 * autoRestart 가 잡지만 죽지 않고 멈춘 경우는 아무도 잡지 않는다 — 화면은 켜져 있는데 모든
 * 요청이 타임아웃하는 최악의 모양이다. 상한을 넘으면 백엔드만 갈아끼운다(하드웨어 자식은
 * 메인의 자식이라 그대로 산다).
 *
 * **연속 몇 번째인지도 센다** — 반복되면 재기동으로 풀릴 문제가 아니라 세대 문제이고, 그때는
 * 부르는 쪽이 되감기로 올라간다. 타이머는 시간 없이 검증하려고 주입받는다.
 */
export type ReadinessWatchdog = {
  /** 백엔드가 떴다 — 준비 선언을 기다리기 시작한다. */
  arm(): void;
  /** 준비 선언이 왔다 — 감시를 푼다. */
  disarm(): void;
};

export function createReadinessWatchdog(deps: {
  timeoutMs: number;
  /** `consecutive` 는 준비 선언 없이 연속으로 상한을 넘긴 횟수(1부터). */
  onTimeout: (consecutive: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): ReadinessWatchdog {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
  const clearTimer =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as never));

  let handle: unknown = null;
  let consecutive = 0;

  function cancel(): void {
    if (handle === null) return;
    clearTimer(handle);
    handle = null;
  }

  return {
    arm() {
      // 재기동이 겹쳐도 감시는 하나만 돈다 — 옛 감시가 새 세대를 죽이면 안 된다.
      // 여기서는 횟수를 지우지 않는다: 재기동은 실패의 결과지 성공의 증거가 아니다.
      cancel();
      handle = setTimer(() => {
        handle = null;
        consecutive += 1;
        deps.onTimeout(consecutive);
      }, deps.timeoutMs);
    },
    disarm() {
      cancel();
      consecutive = 0;
    },
  };
}
