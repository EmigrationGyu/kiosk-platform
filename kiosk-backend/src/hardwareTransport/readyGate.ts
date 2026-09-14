/**
 * 세대별 준비 게이트 — **spawn·연결 예산과 요청 예산을 가른다.**
 *
 * 자식이 아직 말할 수 없는 동안 요청 시계를 돌리면 콜드 부팅 시간이 요청 예산을 갉아먹고, "장비가 느린
 * 것"과 "아직 안 떴다"가 같은 타임아웃으로 보인다. 특히 자기 런타임을 들고 오는 자식(32비트)은 첫
 * spawn 에 런타임 내려받기가 끼어 십 초 단위라, 요청 예산으로 재면 첫 요청은 반드시 죽는다.
 *
 * **판정 단위는 handle(세대)다.** 프로세스가 회수·크래시로 다시 뜨면 `ensure` 가 새 handle 을 주므로
 * 게이트도 다시 기다린다 — 죽은 세대의 준비 상태를 물려주지 않는다.
 */

/** 게이트가 보는 것은 "이 세대가 언제 말할 수 있게 되나" 하나뿐이다. */
export type ReadyHandle = { ready: Promise<void> };

export type ReadyGate = {
  /** 동기 판정 — 이미 통과한 세대면 기다리지 않고 바로 보낸다. */
  isReady(handle: ReadyHandle): boolean;
  /** 준비될 때까지 기다린다. 예산을 넘기면 reject — 요청 예산과 별개다. */
  wait(handle: ReadyHandle): Promise<void>;
};

export function createReadyGate(
  timeoutMs: number,
  label: string,
  now: () => number = Date.now,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  cancel: (id: unknown) => void = (id) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
): ReadyGate {
  let passed: ReadyHandle | null = null;

  return {
    isReady: (handle) => passed === handle,
    wait: (handle) =>
      new Promise<void>((resolve, reject) => {
        const started = now();
        const timer = schedule(() => {
          reject(
            new Error(
              `${label} spawn/connect timeout (${now() - started}ms) — 자식이 준비되지 않았습니다`,
            ),
          );
        }, timeoutMs);
        handle.ready.then(
          () => {
            cancel(timer);
            passed = handle;
            resolve();
          },
          (error: unknown) => {
            cancel(timer);
            reject(error);
          },
        );
      }),
  };
}
