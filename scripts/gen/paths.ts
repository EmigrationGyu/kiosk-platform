import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // scripts/gen

/** 모노레포 셸 루트 (서브모듈들이 위치한 곳) */
export const ROOT = join(here, '..', '..');

export const TYPES = join(ROOT, 'kiosk-types');
export const BACKEND = join(ROOT, 'kiosk-backend');
export const FRONTEND = join(ROOT, 'kiosk-frontend');
export const SERIALPORT = join(ROOT, 'kiosk-serialport');
export const ELECTRON = join(ROOT, 'kiosk-electron');

/** 로그용 — ROOT 기준 상대경로(슬래시 정규화) */
export const rel = (p: string): string =>
  p.slice(ROOT.length + 1).replace(/\\/g, '/');
