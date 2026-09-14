import { describe, expect, test } from 'bun:test';
import { createActivityLog } from '../processManager/activity';
import { createQuiescenceWaiter } from './quiescence';

const setup = () => {
  const activity = createActivityLog(() => 0);
  const waiter = createQuiescenceWaiter({ activity });
  return { activity, waiter };
};

describe('정숙 판정', () => {
  test('아무 명령도 없으면 조용하다', () => {
    expect(createActivityLog(() => 0).isQuiescent()).toBe(true);
  });

  test('한 장치라도 응답 대기 중이면 조용하지 않다', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('token-dispenser');
    expect(activity.isQuiescent()).toBe(false);

    activity.markEnd('token-dispenser', 'answered');
    expect(activity.isQuiescent()).toBe(true);
  });

  test('여러 장치가 겹쳐 있으면 마지막 하나까지 기다린다', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('token-dispenser');
    activity.markStart('token-dispenser');
    activity.markEnd('token-dispenser', 'answered');

    expect(activity.isQuiescent()).toBe(false);

    activity.markEnd('token-dispenser', 'answered');
    expect(activity.isQuiescent()).toBe(true);
  });
});

describe('정숙 대기', () => {
  test('이미 조용하면 즉시 통과한다', async () => {
    const { waiter } = setup();
    await waiter.await();
  });

  test('명령이 끝날 때까지 기다린다', async () => {
    const { activity, waiter } = setup();
    activity.markStart('token-dispenser');

    let settled = false;
    const pending = waiter.await().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    activity.markEnd('token-dispenser', 'answered');
    waiter.notifySettled();
    await pending;
    expect(settled).toBe(true);
  });

  test('일부만 끝나면 아직 깨우지 않는다', async () => {
    const { activity, waiter } = setup();
    activity.markStart('token-dispenser');
    activity.markStart('token-dispenser');

    let settled = false;
    void waiter.await().then(() => {
      settled = true;
    });

    activity.markEnd('token-dispenser', 'answered');
    waiter.notifySettled();
    await Promise.resolve();
    expect(settled).toBe(false);

    activity.markEnd('token-dispenser', 'answered');
    waiter.notifySettled();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  test('여럿이 동시에 기다려도 모두 깨어난다', async () => {
    const { activity, waiter } = setup();
    activity.markStart('ime');

    let woken = 0;
    const all = Promise.all([
      waiter.await().then(() => {
        woken += 1;
      }),
      waiter.await().then(() => {
        woken += 1;
      }),
    ]);

    activity.markEnd('ime', 'answered');
    waiter.notifySettled();
    await all;
    expect(woken).toBe(2);
  });

  test('아무도 안 기다릴 때 알림이 와도 문제없다', () => {
    const { waiter } = setup();
    expect(() => waiter.notifySettled()).not.toThrow();
  });
});

describe('봉투 회수 집계', () => {
  test('아무에게도 안 물어봤으면 조건을 막지 않는다', () => {
    expect(createActivityLog(() => 0).allAnswered()).toBe(true);
  });

  test('물어본 프로세스가 전부 답했으면 통과', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('token-dispenser');
    activity.markEnd('token-dispenser', 'answered');
    activity.markStart('token-dispenser');
    activity.markEnd('token-dispenser', 'answered');

    expect(activity.allAnswered()).toBe(true);
  });

  test('내용이 실패여도 봉투가 왔으면 통과 — 하드웨어 고장은 소프트웨어 판정이 아니다', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('ime');
    // 프린터가 물리적으로 안 붙어 "연결 실패"를 응답했다 — 봉투는 온 것이다.
    activity.markEnd('ime', 'answered');

    expect(activity.allAnswered()).toBe(true);
  });

  test('한 번이라도 답이 없었으면 막는다', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('ime');
    activity.markEnd('ime', 'unanswered');

    expect(activity.allAnswered()).toBe(false);
  });

  test('나중에 답해도 이전의 무응답은 지워지지 않는다', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('ime');
    activity.markEnd('ime', 'unanswered');
    activity.markStart('ime');
    activity.markEnd('ime', 'answered');

    expect(activity.allAnswered()).toBe(false);
  });

  test('물어보는 중(응답 전)이면 아직 통과가 아니다', () => {
    const activity = createActivityLog(() => 0);
    activity.markStart('token-dispenser');

    expect(activity.allAnswered()).toBe(false);
  });
});
