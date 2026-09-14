import { describe, expect, test } from 'bun:test';
import { BRIDGE_METHOD } from 'kiosk-types';
import { bridge, survivesWithoutParent } from './absent';

/**
 * 부모 없는 토폴로지의 브리지 박제.
 *
 * 두 방향으로 다 틀릴 수 있어 양쪽을 고정한다 — 전부 실패시키면 개발 로그가 5초마다
 * 쌓이고(실측), 전부 성공시키면 적용이 일어나지 않았는데 일어난 것처럼 보인다.
 */
describe('부모 없이도 성립하는 호출', () => {
  test('알리기만 하는 호출은 받을 상대가 없어도 할 일이 없다', () => {
    expect(survivesWithoutParent(BRIDGE_METHOD.RENDERER_ALIVE)).toBe(true);
    expect(survivesWithoutParent(BRIDGE_METHOD.UPDATE_MARK_STABLE)).toBe(true);
    expect(survivesWithoutParent(BRIDGE_METHOD.UPDATE_ROLLBACK)).toBe(true);
  });

  test('부모가 대행하는 일은 부모가 없으면 실패가 사실이다', () => {
    expect(survivesWithoutParent(BRIDGE_METHOD.UPDATE_APPLY)).toBe(false);
    expect(survivesWithoutParent(BRIDGE_METHOD.PROCESS_SPAWN)).toBe(false);
    expect(survivesWithoutParent(BRIDGE_METHOD.SECURE_GET)).toBe(false);
  });
});

describe('call', () => {
  test('생존 선언은 성공한다 — 재시도 루프를 끝내는 것이 요점이다', async () => {
    await expect(bridge().call(BRIDGE_METHOD.RENDERER_ALIVE)).resolves.toEqual({
      value: undefined,
      port: null,
    });
  });

  test('적용 요청은 거절된다 — 잠근 채 오지 않을 교체를 기다리면 안 된다', async () => {
    await expect(bridge().call(BRIDGE_METHOD.UPDATE_APPLY)).rejects.toThrow(
      /대행할 상대가 없습니다/,
    );
  });

  test('닿을 길이 없는 구독은 조용히 넘기지 않는다', () => {
    expect(() => bridge().onRendererPort(() => undefined)).toThrow();
    expect(() => bridge().onProcessEvent(() => undefined)).toThrow();
  });
});
