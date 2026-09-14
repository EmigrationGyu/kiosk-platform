import { z } from 'zod';

export const SerialOptionsSchema = z.object({
  portPath: z.string(),
  serialOptions: z.object({
    baudRate: z.number(),
    dataBits: z.number(),
    stopBits: z.number(),
    parity: z.string(),
  }),
});

export type SerialOptions = z.infer<typeof SerialOptionsSchema>;

/**
 * 디바이스 채널 운용 중 발생하는, **디바이스 종류와 무관한** 실패 사유의 닫힌 집합.
 *
 * 각 디바이스의 프로토콜 에러(`CARDKEY_DISPENSER_ERROR_CODE` 등)와는 층이 다르다 —
 * 저쪽은 "장비가 뭐라고 답했나", 이쪽은 "장비에 도달하기 전에 무슨 일이 있었나"다.
 *
 * IPC 경계를 넘는 것은 Error 클래스가 아니라 이 **문자열**이므로, serialport·backend·
 * frontend 세 레포가 같은 값을 봐야 한다. 그래서 여기(types)가 단일 출처다.
 */
export const DEVICE_CHANNEL_CAUSE = {
  /**
   * 비상 복구(리셋)가 대기 중인 요청을 무효화했다.
   *
   * **비재시도** — 같은 요청을 다시 밀어넣으면 방금 리셋한 장비에 무효 명령이 도로 들어간다.
   * 호출부는 재시도가 아니라 플로우를 되감아야 한다.
   */
  OPERATION_PURGED: 'OPERATION_PURGED',
} as const;

export type DeviceChannelCause =
  (typeof DEVICE_CHANNEL_CAUSE)[keyof typeof DEVICE_CHANNEL_CAUSE];

/** 응답 cause 가 채널 레벨 실패인지 판별한다(디바이스 프로토콜 에러와 구분). */
export const isDeviceChannelCause = (
  cause: unknown,
): cause is DeviceChannelCause =>
  typeof cause === 'string' &&
  (Object.values(DEVICE_CHANNEL_CAUSE) as string[]).includes(cause);
