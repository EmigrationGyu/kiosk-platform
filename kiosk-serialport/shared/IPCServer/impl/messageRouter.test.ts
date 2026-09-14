import { beforeAll, describe, expect, it } from 'bun:test';
import { CONTRACT_TOTAL, isContractMismatch } from 'kiosk-types';
import { z } from 'zod';
import { logContractFingerprint } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import type { EventMap } from '../types';
import { type MessagePortLike, MessageRouter } from './messageRouter';

// entry 가 부팅 때 하는 두 가지를 대신한다 — Logger origin 확정, 그리고 정체 신고.
// 지문은 entry 의 신고에서 오므로(ownSurface), 신고 없이 Router 를 쓰면 던진다.
beforeAll(() => {
  Logger.getInstance('ime');
  logContractFingerprint('ime');
});

type Sent = Record<string, unknown>;

/** 테스트용 채널 — 부모 대신 우리가 봉투를 넣고 뺀다. */
function fakePort() {
  const sent: Sent[] = [];
  let deliver: (data: unknown) => void = () => undefined;
  const port: MessagePortLike = {
    postMessage: (m) => {
      sent.push(m as Sent);
    },
    onMessage: (listener) => {
      deliver = listener;
    },
  };
  return {
    port,
    sent,
    /** 요청 봉투를 넣고 응답이 나올 때까지 기다린다(핸들러가 async 라 마이크로태스크 대기). */
    async request(envelope: unknown): Promise<Sent> {
      const before = sent.length;
      deliver(envelope);
      for (let i = 0; i < 50 && sent.length === before; i += 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
      const reply = sent[before];
      if (!reply) throw new Error('응답 봉투가 오지 않았다');
      return reply;
    },
  };
}

type TestMap = {
  '/echo': { request: { n: number }; response: { n: number } };
  '/boom': { request: undefined; response: never };
  '/refuse': { request: undefined; response: never };
};

const schemas = { '/echo': z.object({ n: z.number() }) } as Record<
  string,
  z.ZodSchema
>;

class TestRouter extends MessageRouter<TestMap & EventMap> {
  constructor(private readonly channel: MessagePortLike) {
    super('unused-base-path', schemas);
  }
  protected connect(): MessagePortLike {
    return this.channel;
  }
}

const handlers = {
  '/echo': async (body: { n: number }, res: any) => res.ok(200, body),
  '/boom': async () => {
    throw new Error('핸들러 폭발');
  },
  '/refuse': async (_b: unknown, res: any) => res.error(409, 'REFUSED'),
} as never;

function serve() {
  const fake = fakePort();
  const router = new TestRouter(fake.port);
  router.serveAll(handlers);
  return { fake, router };
}

describe('MessageRouter — 봉투 규약', () => {
  it('정상 응답에 결과와 지문이 함께 실린다', async () => {
    const { fake } = serve();
    const reply = await fake.request({
      id: 'a',
      event: '/echo',
      body: { n: 1 },
    });
    expect(reply).toMatchObject({
      id: 'a',
      ok: true,
      code: 200,
      result: { n: 1 },
    });
    // 지문 두 종 — surface 가 판정 근거, total 은 진단용.
    expect(reply.contract).toBe(CONTRACT_TOTAL);
    expect(typeof reply.surface).toBe('string');
  });

  it('Zod 실패는 400 — 핸들러까지 가지 않는다', async () => {
    const { fake } = serve();
    const reply = await fake.request({
      id: 'b',
      event: '/echo',
      body: { n: 'not-a-number' },
    });
    expect(reply).toMatchObject({ id: 'b', ok: false, code: 400 });
    expect(String(reply.cause)).toContain('n');
  });

  it('parse 결과가 핸들러로 간다 — strip/transform 이 실제로 먹어야 한다', async () => {
    const { fake } = serve();
    const reply = await fake.request({
      id: 'c',
      event: '/echo',
      body: { n: 7, 몰래: '끼워넣기' },
    });
    // z.object 는 미지의 키를 벗긴다 — 원본이 그대로 갔으면 이 키가 남는다.
    expect(reply.result).toEqual({ n: 7 });
  });

  it('미등록 이벤트는 404 + 계약 불일치 표식', async () => {
    const { fake } = serve();
    const reply = await fake.request({ id: 'd', event: '/없음', body: null });
    expect(reply).toMatchObject({ id: 'd', ok: false, code: 404 });
    // 지문을 안 싣는 옛 산출물은 지문 대조로 안 잡힌다 — 이 표식만이 증거다.
    expect(isContractMismatch(reply.cause)).toBe(true);
  });

  it('핸들러가 던지면 500 — 내부 사정이 밖으로 새지 않는다', async () => {
    const { fake } = serve();
    const reply = await fake.request({ id: 'e', event: '/boom', body: null });
    expect(reply).toMatchObject({ id: 'e', ok: false, code: 500 });
    expect(reply.cause).toBe('Internal Server Error');
    expect(String(reply.cause)).not.toContain('폭발');
  });

  it('핸들러의 명시적 거절은 그 코드·사유 그대로 나간다', async () => {
    const { fake } = serve();
    const reply = await fake.request({ id: 'f', event: '/refuse', body: null });
    expect(reply).toMatchObject({
      id: 'f',
      ok: false,
      code: 409,
      cause: 'REFUSED',
    });
  });
});

describe('MessageRouter — 핸들러 등록', () => {
  it('같은 URL 을 두 번 서브하면 던진다', () => {
    const { router } = serve();
    expect(() => router.serveAll(handlers)).toThrow('already served');
  });

  it('replaceHandlers 는 등록된 것만 갈아끼운다 (HMR 경로)', async () => {
    const { fake, router } = serve();
    router.replaceHandlers({
      '/echo': async (_b: unknown, res: any) => res.ok(201, { n: 99 }),
    } as never);
    const reply = await fake.request({
      id: 'g',
      event: '/echo',
      body: { n: 1 },
    });
    expect(reply).toMatchObject({ ok: true, code: 201, result: { n: 99 } });
  });

  it('등록되지 않은 URL 교체는 던진다 — 조용히 새 핸들러가 생기면 안 된다', () => {
    const { router } = serve();
    expect(() =>
      router.replaceHandlers({ '/처음보는것': async () => undefined } as never),
    ).toThrow('Cannot replace unregistered URL');
  });
});
