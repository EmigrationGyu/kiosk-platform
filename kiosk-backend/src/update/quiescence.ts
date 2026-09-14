import type { ActivityLog } from '../processManager/activity';

/**
 * 장치 명령이 모두 끝나기를 기다린다 — 업데이트 적용 시점을 고르는 신호.
 *
 * 폴링이 아니라 "조용해지면 알려줘"인 이유: 폴링은 조용함을 관측한 순간과 실제로 교체하는
 * 순간이 벌어진다. 또 백엔드가 **거절 상태로 들어가지 않는다** — 부모가 타임아웃으로
 * 포기해도 여기서 걸린 약속이 나중에 resolve 될 뿐, 막히는 상태가 남지 않는다.
 *
 * 끊긴 명령은 "실패"가 아니라 결과 불명이다(장치까지 갔는지 알 수 없다). 그래서 처리하는
 * 대신 **일어나지 않게** 한다.
 */
export type QuiescenceWaiter = {
  /** 이미 조용하면 즉시, 아니면 조용해질 때 resolve. */
  await(): Promise<void>;
  /** 명령이 끝날 때마다 부른다 — 대기 중인 쪽을 깨운다. */
  notifySettled(): void;
};

export function createQuiescenceWaiter(deps: {
  activity: Pick<ActivityLog, 'isQuiescent'>;
}): QuiescenceWaiter {
  let waiters: (() => void)[] = [];

  return {
    await() {
      if (deps.activity.isQuiescent()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },

    notifySettled() {
      if (waiters.length === 0) return;
      if (!deps.activity.isQuiescent()) return;
      // 깨우기 전에 목록을 비운다 — resolve 가 동기적으로 새 대기를 만들 수 있다.
      const woken = waiters;
      waiters = [];
      for (const resolve of woken) resolve();
    },
  };
}
