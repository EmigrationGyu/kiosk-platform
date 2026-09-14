import { describe, expect, test } from 'bun:test';
import {
  BRIDGE_ENV,
  BRIDGE_METHOD,
  type BridgeCall,
  type BridgeEvent,
  type BridgeResult,
  isBridgeCall,
  isBridgeEvent,
  isBridgeResult,
  isPortHandoff,
  isPortRequest,
  isPortResponse,
  type PortHandoff,
  type PortMessage,
  type PortRequest,
  type PortResponse,
} from './envelope';

/**
 * 포트 봉투 박제.
 *
 * 이 봉투의 존재 이유는 "전송 수단을 바꾸되 안쪽 계약은 건드리지 않는다"이므로,
 * 안쪽 봉투가 그대로 실려 나오는지와 판별자가 서로 배타적인지를 고정한다.
 */

const request: PortRequest = {
  kind: 'request',
  address: '/cash_dispenser/deposit',
  id: 'req-1',
  body: { amount: 1000 },
};

const response: PortResponse = {
  kind: 'response',
  id: 'req-1',
  // 기존 WireResponse 봉투 그대로.
  payload: { result: { ok: true }, id: 'req-1', code: 200, ok: true },
};

const call: BridgeCall = {
  kind: 'call',
  id: 'call-1',
  method: BRIDGE_METHOD.SECURE_GET,
  args: ['kiosk', 'auth-token'],
};

const handoff: PortHandoff = { kind: 'port', tag: 'renderer' };

const childEvent: BridgeEvent = {
  kind: 'event',
  process: 'token-dispenser',
  event: 'exit',
  code: 0,
};

const result: BridgeResult = {
  kind: 'result',
  id: 'call-1',
  ok: true,
  value: 'token',
};

describe('포트 봉투', () => {
  test('안쪽 와이어 응답을 변형 없이 싣는다', () => {
    const inner = { cause: 'E_X', id: 'req-9', code: 501, ok: false };
    const wrapped: PortResponse = {
      kind: 'response',
      id: 'req-9',
      payload: inner,
    };
    // 전송 수단이 바뀌어도 파싱하는 쪽이 보는 것은 동일해야 한다.
    expect(wrapped.payload).toBe(inner);
  });

  test('판별자는 서로 배타적이다', () => {
    const messages: PortMessage[] = [
      request,
      response,
      call,
      result,
      handoff,
      childEvent,
    ];
    const guards = [
      isPortRequest,
      isPortResponse,
      isBridgeCall,
      isBridgeResult,
      isPortHandoff,
      isBridgeEvent,
    ];

    for (const message of messages) {
      const matched = guards.filter((guard) => guard(message));
      expect(matched).toHaveLength(1);
    }
  });

  test('모든 메시지가 어떤 판별자에도 걸린다 — 누락된 kind 가 없다', () => {
    const kinds = new Set<PortMessage['kind']>([
      'request',
      'response',
      'call',
      'result',
      'port',
      'event',
    ]);
    const covered = new Set(
      [request, response, call, result, handoff, childEvent].map((m) => m.kind),
    );
    expect(covered).toEqual(kinds);
  });
});

/**
 * 브리지 능력 집합 트립와이어.
 *
 * 여기가 자라면 백엔드가 electron 에 다시 묶이고 있다는 뜻이다. 늘려야 한다면 기대값을
 * 갱신하되, 그 능력이 정말 electron 에서만 가능한지 먼저 따져봐야 한다
 * (Platform 값으로 표현 가능하면 env 주입이 맞다).
 */
describe('브리지 능력 집합', () => {
  test('닫힌 집합이 조용히 늘어나지 않았다', () => {
    expect(Object.values(BRIDGE_METHOD)).toEqual([
      'secureStorage.set',
      'secureStorage.get',
      'secureStorage.delete',
      'process.spawn',
      'process.kill',
      'renderer.subscribePort',
      'renderer.alive',
      'update.apply',
      'update.markStable',
      'update.rollback',
      'update.record',
      'update.reported',
    ]);
  });

  test('주입 환경 값도 닫혀 있다', () => {
    expect(Object.values(BRIDGE_ENV)).toEqual([
      'KIOSK_USER_DATA',
      'KIOSK_BASELINE',
      'KIOSK_APP_VERSION',
      'KIOSK_IS_PACKAGED',
    ]);
  });
});
