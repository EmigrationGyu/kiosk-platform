/**
 * "한 번에 하나만" 실행 래치.
 *
 * 이미 실행 중이면 새로 시작하지 않고 **진행 중인 약속에 합류**시킨다(join).
 * 세션 종료·정리처럼 **여러 곳에서 동시에 트리거될 수 있지만 실제로는 한 번만
 * 일어나야 하는 작업**을 위한 것 — 중복 실행은 같은 mutation 을 동일 variables 로
 * 동시 발사해 서버가 Idempotency-Key 충돌로 거절하게 만들거나(409), 정리/이동을
 * 두 번 돌려 상태를 어긋나게 한다.
 *
 * 재진입 방지를 boolean 플래그로 하면 "이미 돌고 있으니 무시"밖에 못 하지만,
 * 약속을 돌려주면 호출자가 완료를 await 할 수 있다는 점이 다르다.
 */
export type SingleFlight = {
  /** 진행 중인 실행. 없으면 null — 가드를 건너뛰고 합류할지 판단하는 데 쓴다. */
  current: () => Promise<void> | null;
  /** 실행 중이면 그 약속을, 아니면 task 를 시작하고 그 약속을 돌려준다. */
  run: (task: () => Promise<void>) => Promise<void>;
};

export const createSingleFlight = (): SingleFlight => {
  let inFlight: Promise<void> | null = null;

  return {
    current: () => inFlight,
    run: (task) => {
      if (inFlight) return inFlight;
      // task() 가 동기적으로 throw 해도 래치가 영구히 잠기지 않도록 약속으로 감싼다.
      const started = (async () => task())().finally(() => {
        inFlight = null;
      });
      inFlight = started;
      return started;
    },
  };
};
