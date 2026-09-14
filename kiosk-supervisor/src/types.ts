/**
 * 공유 타입 / Zod 스키마. 외부에서 들어오는 데이터(S3 매니페스트, IPC 메시지)는 반드시 여기
 * 스키마로 검증한 뒤 내부 로직으로 흘려야 한다.
 */

import { z } from 'zod';

// S3 매니페스트 (latest.json)
export const ManifestSchema = z.object({
  version: z.string(),
  url: z.string(),
  sigUrl: z.string(),
  sha256: z.string(),
  minLoaderVersion: z.string(),
  publishedAt: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// Loader ↔ daemon heartbeat
// daemon.js 가 살아있음을 로더에게 알리는 신호.
export const DaemonHeartbeatSchema = z.object({
  type: z.literal('daemon-alive'),
  daemonVersion: z.string(),
  uptimeMs: z.number(),
});
export type DaemonHeartbeat = z.infer<typeof DaemonHeartbeatSchema>;

// Daemon ↔ 키오스크 Electron heartbeat
// 키오스크 앱이 살아있음을 daemon 에게 알리는 신호.
// 끊기면 daemon 이 작업 스케줄러로 재기동 트리거.
export const KioskHeartbeatSchema = z.object({
  type: z.literal('kiosk-alive'),
  kioskVersion: z.string(),
  uptimeMs: z.number(),
  // 키오스크 자동시작/재기동 task 를 daemon(SYSTEM)이 생성·보수하기 위한 정보.
  // 비-Squirrel/개발 환경에선 없을 수 있어 optional.
  launch: z
    .object({
      updateExe: z.string(), // Squirrel Update.exe 절대경로 (버전 불변 stub)
      exeName: z.string(), // app 실행 파일명 (예: Kiosk.exe)
      username: z.string(), // onlogon task 의 실행 사용자
    })
    .optional(),
});
export type KioskHeartbeat = z.infer<typeof KioskHeartbeatSchema>;

// 키오스크 적용 기록 (daemon 은 읽기만)
// 키오스크가 `<프로필>\Kiosk\update\last-apply.json` 에 남기는 마지막 적용 결과.
// 여기서 쓰는 것은 "지금 설치 중인가" 하나뿐이라 **필요한 필드만** 받는다 — 나머지는
// 키오스크의 관심사고, 여기 베껴두면 그쪽 스키마가 늘 때마다 조용히 어긋난다.
export const KioskApplyRecordSchema = z.looseObject({
  at: z.string(),
  outcome: z.string(),
  requestedBase: z.string().nullish(),
});
export type KioskApplyRecord = z.infer<typeof KioskApplyRecordSchema>;

// Negative cache
// heartbeat 실패로 롤백된 daemon.js 버전 기록.
// 같은 버전 매니페스트가 와도 재시도 안 함.
export const NegativeCacheEntrySchema = z.object({
  version: z.string(),
  failedAt: z.string(),
  reason: z.string(),
});
export type NegativeCacheEntry = z.infer<typeof NegativeCacheEntrySchema>;

export const NegativeCacheSchema = z.array(NegativeCacheEntrySchema);
export type NegativeCache = z.infer<typeof NegativeCacheSchema>;
