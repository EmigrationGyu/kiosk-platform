import { describe, expect, test } from 'bun:test';
import { DEVICE_IDS, type DeviceId } from 'src/constant/events/Hardware';
import {
  type AvailabilityProbes,
  resolveAvailability,
} from './deviceAvailability';

// 판정 대상이 여럿일 때의 동작이 논점이라 실제 장치 id 는 중요하지 않다 — 하나는 실제
// 값을 쓰고 나머지는 합성한다. 이 레포의 닫힌 집합이 1개라 픽스처가 그에 묶이면
// "여러 장치" 케이스를 못 쓴다.
const A = DEVICE_IDS.TOKEN_DISPENSER as string;
const B = 'device_b';
const C = 'device_c';
const ALL = [A, B, C] as DeviceId[];

/** claimed 집합과 healthCheck 통과 집합을 각각 지정한 판정기. */
const probes = (
  claimed: string[],
  healthy: string[],
  onHealthCheck?: (id: string) => void,
): AvailabilityProbes => ({
  isClaimed: (id) => claimed.includes(id),
  healthCheck: async (id) => {
    onHealthCheck?.(id);
    if (!healthy.includes(id)) throw new Error(`${id} unhealthy`);
  },
});

// 반환 타입은 DeviceId 키로 좁혀져 있는데(닫힌 집합 1개) 이 테스트는 합성 id 를 쓰므로
// 비교 시점에만 넓힌다 — 판정 로직은 id 를 불투명 문자열로 다루는 것이 계약이다.
const availability = async (
  ids: DeviceId[],
  p: AvailabilityProbes,
): Promise<Record<string, boolean>> =>
  (await resolveAvailability(ids, p)) as Record<string, boolean>;

describe('resolveAvailability', () => {
  test('lease 를 쥔 기기는 연결됨', async () => {
    expect(await availability(ALL, probes(ALL, []))).toEqual({
      [A]: true,
      [B]: true,
      [C]: true,
    });
  });

  /**
   * 2026-09-01 실측 재현 — 원격 업데이트 직후. 백엔드 세대가 갈려 lease 는 전부
   * 사라졌지만 서브프로세스는 포트를 쥔 채 정상 응답 중이었다.
   */
  test('lease 가 없어도 장치가 답하면 연결됨 ★', async () => {
    expect(await availability(ALL, probes([], ALL))).toEqual({
      [A]: true,
      [B]: true,
      [C]: true,
    });
  });

  test('lease 도 없고 답도 없으면 연결 실패 — 진짜 미장착', async () => {
    expect(await availability(ALL, probes([], []))).toEqual({
      [A]: false,
      [B]: false,
      [C]: false,
    });
  });

  test('기기별로 갈린다 — 한 대만 살아 있어도 그 대만 연결됨', async () => {
    expect(await availability(ALL, probes([B], [C]))).toEqual({
      [A]: false,
      [B]: true,
      [C]: true,
    });
  });

  test('claim 을 딴 기기에는 healthCheck 를 묻지 않는다 — 왕복 낭비 방지 ★', async () => {
    const asked: string[] = [];
    await availability(
      ALL,
      probes([B], ALL, (id) => asked.push(id)),
    );

    expect(asked.sort()).toEqual([C, A].sort());
  });

  test('빈 목록은 빈 결과', async () => {
    expect(await availability([], probes([], []))).toEqual(
      {} as Record<string, boolean>,
    );
  });
});
