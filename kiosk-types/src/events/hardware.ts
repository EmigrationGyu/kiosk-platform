import { z } from 'zod';
import { SERIALPORT_PROCESS } from '../serialport/processes';

export const DEVICE_IDS = {
  TOKEN_DISPENSER: 'token_dispenser',
} as const;

export const ZodDeviceId = z.enum([DEVICE_IDS.TOKEN_DISPENSER]);

export type DeviceId = z.infer<typeof ZodDeviceId>;

// ── Warmup (lazy-spawn 서브프로세스 프리웜) ──────────────────────────────────

// 프리웜 가능한 서브프로세스의 닫힌 집합. 백엔드의 워밍 전략 맵이 이 집합을
// satisfies 로 강제하므로, 여기 추가하면 전략을 채우기 전까지 컴파일 에러가 난다.
// 원본에서는 이 집합과 DEVICE_IDS·SERIALPORT_PROCESS 가 서로 다른 크기였다 — 조건부
// 설치 장비를 의도적으로 뺀 결과인데, 그 탓에 "이 키오스크가 실제로 쓰는 장치"를 뜻하는
// 집합이 어디에도 없어 부팅 중 아무도 접촉하지 않는 서브프로세스가 생겼다(승격 검증 사각지대).
export const WARMABLE_PROCESSES = [
  SERIALPORT_PROCESS.IME,
  SERIALPORT_PROCESS.TOKEN_DISPENSER,
  // @gen:warmable
] as const;

export const ZodWarmableProcess = z.enum(WARMABLE_PROCESSES);
export type WarmableProcess = z.infer<typeof ZodWarmableProcess>;

export const HARDWARE_EVENTS = {
  SCAN: '/scan',
  WARMUP: '/warmup',
} as const;

export const HardwareSchemas = {
  [HARDWARE_EVENTS.SCAN]: z.array(ZodDeviceId),
  [HARDWARE_EVENTS.WARMUP]: z.array(ZodWarmableProcess),
} satisfies Record<keyof HardwareEventMap, z.ZodType>;

export type ScanResult = Partial<Record<DeviceId, boolean>>;

// ── Response schemas ─────────────────────────────────────────────────────────

const ScanResultSchema = z.object({
  [DEVICE_IDS.TOKEN_DISPENSER]: z.boolean().optional(),
});

const WarmupResultSchema = z.partialRecord(ZodWarmableProcess, z.boolean());

export type WarmupResult = z.infer<typeof WarmupResultSchema>;

export const HardwareResponseSchemas = {
  [HARDWARE_EVENTS.SCAN]: ScanResultSchema,
  [HARDWARE_EVENTS.WARMUP]: WarmupResultSchema,
} satisfies Record<keyof HardwareEventMap, z.ZodType>;

export type HardwareEventMap = {
  [HARDWARE_EVENTS.SCAN]: {
    request: z.infer<(typeof HardwareSchemas)[typeof HARDWARE_EVENTS.SCAN]>;
    response: ScanResult;
  };
  [HARDWARE_EVENTS.WARMUP]: {
    request: z.infer<(typeof HardwareSchemas)[typeof HARDWARE_EVENTS.WARMUP]>;
    response: WarmupResult;
  };
};
