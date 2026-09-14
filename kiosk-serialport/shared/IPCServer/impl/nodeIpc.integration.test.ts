import { afterEach, describe, expect, it } from 'bun:test';
import { fork } from 'node:child_process';
import path from 'node:path';
import { CONTRACT_TOTAL } from 'kiosk-types';

/**
 * node-ipc Router 를 **실제 `child_process.fork` 로** 왕복시킨다.
 *
 * fake 포트 테스트(messageRouter.test.ts)가 봉투 규약을 박제한다면, 여기는
 * "그 채널이 정말 있는가"에 답한다 — `process.send` 존재, 부모↔자식 메시지 모양,
 * 부모가 끊을 때 자식이 함께 내려가는지. 이 셋은 프로세스를 진짜 띄워야만 확인된다.
 *
 * 부모가 electron 메인 대신 bun 이라는 점만 다르고, 자식이 보는 것은 프로덕션과 같다.
 */

/**
 * **bun 전제.** 자식을 `process.execPath` 로 fork 하는데 그 엔트리가 `.ts` 라,
 * 확장자를 그대로 실행할 수 있는 런타임이어야 한다(패키지의 `test` 스크립트가 bun 이다).
 * node 로 이 스위트를 돌리면 자식이 뜨지 못해 실패한다.
 */
const CHILD = path.join(import.meta.dir, '__fixtures__', 'nodeIpcChild.ts');

type Envelope = Record<string, unknown>;

const children: ReturnType<typeof fork>[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function spawnChild() {
  // bun 으로 TS 자식을 띄운다 — 프로덕션은 번들된 js 를 node32 로 띄우지만,
  // 검증 대상은 IPC 채널이지 번들러가 아니다.
  const child = fork(CHILD, [], {
    execPath: process.execPath,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);

  const inbox: Envelope[] = [];
  child.on('message', (m) => inbox.push(m as Envelope));

  const waitFor = async (
    match: (m: Envelope) => boolean,
    label: string,
  ): Promise<Envelope> => {
    for (let i = 0; i < 200; i += 1) {
      const found = inbox.find(match);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${label} 을(를) 기다리다 타임아웃`);
  };

  return { child, waitFor };
}

describe('node-ipc Router — 실제 fork 왕복', () => {
  it('자식이 IPC 채널로 부팅을 알리고 요청에 답한다', async () => {
    const { child, waitFor } = spawnChild();
    await waitFor((m) => m.boot === 'ready', '자식 부팅');

    child.send({ id: 'x1', event: '/echo', body: { n: 21 } });
    const reply = await waitFor((m) => m.id === 'x1', '응답');

    expect(reply).toMatchObject({ ok: true, code: 200, result: { n: 42 } });
    // 지문이 실려야 백엔드가 이 장치와 말이 통하는지 판정할 수 있다.
    expect(reply.contract).toBe(CONTRACT_TOTAL);
    expect(typeof reply.surface).toBe('string');
  }, 30_000);

  it('부팅 직후 밀어넣은 요청도 잃지 않는다 — 채널이 버퍼링한다', async () => {
    const { child, waitFor } = spawnChild();
    // ready 를 안 기다리고 바로 보낸다. fork 는 채널을 동기적으로 깔아주므로
    // 자식이 리스너를 붙이기 전에 도착한 메시지도 Node 가 들고 있어야 한다.
    child.send({ id: 'x2', event: '/echo', body: { n: 1 } });
    const reply = await waitFor((m) => m.id === 'x2', '응답');
    expect(reply).toMatchObject({ ok: true, result: { n: 2 } });
  }, 30_000);

  it('부모가 채널을 끊으면 자식이 스스로 내려간다 — 고아가 포트를 물면 안 된다', async () => {
    const { child, waitFor } = spawnChild();
    await waitFor((m) => m.boot === 'ready', '자식 부팅');

    const exited = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code)),
    );
    child.disconnect();
    expect(await exited).toBe(0);
  }, 30_000);
});
