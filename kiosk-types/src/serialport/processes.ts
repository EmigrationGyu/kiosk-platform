/**
 * serialport 서브프로세스 식별자 + IPC 파이프 경로 — 단일 출처. 값은 패키지 디렉토리명이자 pipe
 * 이름의 어근이다. backend·serialport·electron·dev 스크립트가 모두 여기를 참조해 같은 pipe 로 만난다.
 */
export const SERIALPORT_PROCESS = {
  IME: 'ime',
  TOKEN_DISPENSER: 'token-dispenser',
  OUTBOX: 'outbox',
  // @gen:serialport-process
} as const;

export type SerialportProcess =
  (typeof SERIALPORT_PROCESS)[keyof typeof SERIALPORT_PROCESS];

/**
 * 서브프로세스 식별자 → IPC 경로. 모듈 로드 시 플랫폼별로 확정한다 — Windows=named pipe, 그 외=Unix
 * 소켓(/tmp). pm2 멀티프로세스는 cwd 가 제각각이라 절대경로로 고정한다. types 는 frontend 브라우저
 * 번들에도 들어가므로 `process` 부재를 가드한다(거기선 미사용).
 */
const proc = (
  globalThis as {
    process?: { versions?: { node?: string }; platform?: string };
  }
).process;

const isWindows = !!proc?.versions?.node && proc.platform === 'win32';

export const serialportPipePath = (name: SerialportProcess): string =>
  isWindows ? `\\\\.\\pipe\\kiosk-${name}` : `/tmp/kiosk-${name}.sock`;

// 디바이스별 named 상수 — backend(events re-export)·serialport(router import)용.
// electron·dev 는 SERIALPORT_PROCESS + serialportPipePath 로 직접 파생한다.
export const IME_PIPE_PATH = serialportPipePath(SERIALPORT_PROCESS.IME);
export const TOKEN_DISPENSER_PIPE_PATH = serialportPipePath(
  SERIALPORT_PROCESS.TOKEN_DISPENSER,
);
export const OUTBOX_PIPE_PATH = serialportPipePath(SERIALPORT_PROCESS.OUTBOX);
// @gen:serialport-pipe
