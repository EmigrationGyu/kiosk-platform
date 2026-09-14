import { platform } from '@platform/Platform';
import net from 'net';
import os from 'os';
import path from 'path';
import { LogService } from 'src/service/LogService';

/**
 * Kiosk → Supervisor daemon heartbeat.
 *
 * supervisor daemon 이 이 heartbeat 로 키오스크 생존을 감시하고, 끊기면 작업 스케줄러로 재기동한다
 * (의존성 방향: daemon → kiosk).
 *
 * **키오스크가 pipe 서버, daemon 이 클라이언트다.** daemon 은 LocalSystem 이라 SYSTEM 이 만든 서버
 * pipe 엔 비승격 키오스크가 EPERM 으로 못 붙는다(기본 DACL). 반대로 사용자 pipe 엔 SYSTEM 이 항상
 * 붙을 수 있어 방향을 뒤집었다.
 *
 * 계약은 kiosk-supervisor 와 반드시 일치해야 한다 — 파이프 경로는 그쪽 `src/constants.ts` 의
 * IPC_PIPE_KIOSK, 메시지는 `src/types.ts` 의 KioskHeartbeatSchema(한 줄 JSON + 개행).
 */

// supervisor IPC_PIPE_KIOSK 와 동일해야 함.
const PIPE_PATH = '\\\\.\\pipe\\kiosk-electron';
const HEARTBEAT_INTERVAL_MS = 5_000;
const RECONNECT_DELAY_MS = 3_000;

// supervisor KioskHeartbeatSchema 와 동일 형태여야 함.
type KioskHeartbeat = {
  type: 'kiosk-alive';
  kioskVersion: string;
  uptimeMs: number;
  launch?: { updateExe: string; exeName: string; username: string };
};

/**
 * daemon(SYSTEM)이 키오스크 자동시작/재기동 task 를 생성·보수하는 데 쓰는 launch 정보.
 *
 * 프로덕션에서 이 백엔드는 electron 메인 프로세스에 import 되어 도므로 process.execPath
 * 가 곧 설치된 키오스크 실행 파일이다. Squirrel 레이아웃: <root>\app-<ver>\<exe>,
 * <root>\Update.exe(버전 불변 stub). daemon 은 updateExe 존재를 확인한 뒤에만 task 를
 * 만들므로, 개발 환경의 무의미한 경로는 무해하게 무시된다.
 */
function resolveLaunch(): NonNullable<KioskHeartbeat['launch']> {
  return {
    updateExe: path.resolve(process.execPath, '..', '..', 'Update.exe'),
    exeName: path.basename(process.execPath),
    username: os.userInfo().username,
  };
}

/**
 * supervisor daemon 으로의 heartbeat 송신을 시작하고, 중지 함수를 반환한다.
 * daemon 이 아직 없거나 파이프가 끊기면 조용히 재연결을 반복한다(개발 환경 포함).
 */
export function startSupervisorHeartbeat(): () => void {
  const log = LogService.getInstance();
  const kioskVersion = platform.appVersion;
  const launch = resolveLaunch(); // 불변 — 1회 계산해 매 비트에 동봉.
  const startedAt = Date.now();

  const beatLine = (): string =>
    `${JSON.stringify({
      type: 'kiosk-alive',
      kioskVersion,
      uptimeMs: Date.now() - startedAt,
      launch,
    } satisfies KioskHeartbeat)}\n`;

  let server: net.Server | null = null;
  let relistenTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  // daemon(클라이언트)이 붙으면 그 소켓에 주기적으로 heartbeat 를 흘린다.
  const onDaemon = (socket: net.Socket) => {
    log.info('[supervisorHeartbeat] daemon connected');
    const send = () => {
      if (!socket.destroyed && socket.writable) socket.write(beatLine());
    };
    send(); // 즉시 첫 비트
    const timer = setInterval(send, HEARTBEAT_INTERVAL_MS);
    socket.on('close', () => clearInterval(timer));
    socket.on('error', () => socket.destroy());
  };

  const listen = () => {
    if (stopped) return;
    const s = net.createServer(onDaemon);
    server = s;
    // pipe 점유 잔여(EADDRINUSE) 등 — 잠시 후 재시도. (서버라 daemon 미기동과는 무관.)
    s.on('error', (err) => {
      log.info('[supervisorHeartbeat] server error, relisten', {
        unmasked: { reason: err.message },
      });
      if (!stopped && !relistenTimer) {
        relistenTimer = setTimeout(() => {
          relistenTimer = null;
          listen();
        }, RECONNECT_DELAY_MS);
      }
    });
    s.listen(PIPE_PATH);
  };

  listen();

  return () => {
    stopped = true;
    if (relistenTimer) clearTimeout(relistenTimer);
    server?.close();
  };
}
