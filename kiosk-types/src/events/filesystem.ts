import { z } from 'zod';

export const FILESYSTEM_EVENTS = {
  SAVE: '/save',
  READ: '/read',
} as const;

/**
 * 프론트엔드가 지정할 수 있는 저장 목적지의 닫힌 집합. 실제 디스크 경로는 백엔드만 알고 토큰을
 * 해석한다 — 렌더러가 절대경로를 실어 보내는 계약은 폐기했다(임의 경로 쓰기 방지).
 */
export const SAVE_DIRECTORIES = {
  AUTH_SIGNATURE: 'AUTH_SIGNATURE',
  /** 단말 설정(`~/.kiosk/config`). 화면에서 쓰고 화면에서 읽는 설정 파일. */
  CONFIG: 'CONFIG',
} as const;

/**
 * 설정 파일 이름 — **읽기 경로(백엔드)와 쓰기 파일명(프론트)의 단일 출처.** 양쪽이 각자 이름을
 * 들고 있으면 한쪽만 바뀌었을 때 쓰기는 성공하는데 아무도 안 읽는 파일이 생긴다.
 */
export const CONFIG_FILE_NAMES = {
  /** 카메라 배정(신분증/전면). 없으면 기본 디바이스 이름으로 폴백. */
  CAMERA: 'camera.json',
} as const;

export type SaveDirectory =
  (typeof SAVE_DIRECTORIES)[keyof typeof SAVE_DIRECTORIES];

/**
 * 프론트엔드가 읽을 수 있는 소스의 닫힌 집합. SAVE 와 동일하게 토큰만 오가고
 * 실제 경로/파일명은 백엔드가 해석한다.
 * - COLOR_CALIBRATION: OCR 전 색 보정 행렬 CSV (`~/.kiosk/config`).
 *   미보정 현장에는 파일이 없는 게 정상이므로 응답은 nullable(없으면 null).
 */
export const READ_SOURCES = {
  COLOR_CALIBRATION: 'COLOR_CALIBRATION',
  /**
   * 카메라 배정(`~/.kiosk/config/camera.json`). 관리자 화면이 쓰고 boot 가 읽는다.
   * 파일이 없는 게 기본 상태이므로(= 기본 카메라 사용) 응답은 nullable.
   */
  CAMERA_ASSIGNMENT: 'CAMERA_ASSIGNMENT',
} as const;

export type ReadSource = (typeof READ_SOURCES)[keyof typeof READ_SOURCES];

export const FileSystemSchemas = {
  [FILESYSTEM_EVENTS.SAVE]: z.object({
    directory: z.enum(SAVE_DIRECTORIES),
    fileName: z.string(),
    data: z.union([
      z.string(),
      z.instanceof(ArrayBuffer),
      z.instanceof(Uint8Array),
    ]),
  }),
  [FILESYSTEM_EVENTS.READ]: z.object({
    source: z.enum(READ_SOURCES),
  }),
} satisfies Record<keyof FileSystemEventMap, z.ZodType>;

// Response schemas

export const FileSystemResponseSchemas = {
  [FILESYSTEM_EVENTS.SAVE]: z.void(),
  [FILESYSTEM_EVENTS.READ]: z.string().nullable(),
} satisfies Record<keyof FileSystemEventMap, z.ZodType>;

export type FileSystemEventMap = {
  [FILESYSTEM_EVENTS.SAVE]: {
    request: z.infer<(typeof FileSystemSchemas)[typeof FILESYSTEM_EVENTS.SAVE]>;
    response: void;
  };
  [FILESYSTEM_EVENTS.READ]: {
    request: z.infer<(typeof FileSystemSchemas)[typeof FILESYSTEM_EVENTS.READ]>;
    response: string | null;
  };
};
