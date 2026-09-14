import type { DeviceId } from 'src/constant/events/Hardware';

/**
 * 기기점검 판정 — **"스캐너가 포트를 쥐었나"가 아니라 "장치가 답하나"**.
 *
 * 둘은 보통 같이 움직이지만 갈리는 상태가 있다: 백엔드 세대가 갈리면 스캐너의 `leases`(인스턴스 필드)는
 * 통째로 사라지는데 서브프로세스는 포트를 쥔 채 살아 있다. 그때 `isDeviceClaimed` 만 보면 멀쩡히
 * 동작하는 장치를 "연결 실패"로 보고한다(실측 2026-09-01: 원격 업데이트 직후 3종 전부 연결 실패로
 * 떴으나 같은 순간 서브프로세스는 getStatus 를 정상 응답하고 있었다). 즉 기능은 멀쩡하고 **보고만 거짓**.
 *
 * 그래서 claim 을 못 딴 기기에만 healthCheck 를 한 번 더 묻는다. `ensureDevice` 의 복구 사다리는 타지
 * 않는다 — 진짜 미장착 기기에서 기기점검 재시도 루프가 그만큼 무거워지면 안 된다.
 */
export type AvailabilityProbes = {
  /** 스캐너가 이 기기의 포트를 쥐고 있는가(동기). */
  isClaimed: (deviceId: DeviceId) => boolean;
  /** 서브프로세스에 ping — 에러 상태면 reject. */
  healthCheck: (deviceId: DeviceId) => Promise<void>;
};

export const resolveAvailability = async (
  deviceIds: readonly DeviceId[],
  probes: AvailabilityProbes,
): Promise<Record<DeviceId, boolean>> => {
  // claim 을 먼저 전부 읽는다 — healthCheck 왕복 중에 폴링이 lease 를 만들면
  // 같은 판정 안에서 기기마다 다른 시점을 보게 된다.
  const claimed = deviceIds.map((id) => probes.isClaimed(id));
  const settled = await Promise.allSettled(
    deviceIds.map((id, i) =>
      claimed[i] ? Promise.resolve() : probes.healthCheck(id),
    ),
  );
  return Object.fromEntries(
    deviceIds.map((id, i) => [id, settled[i]?.status === 'fulfilled']),
  ) as Record<DeviceId, boolean>;
};
