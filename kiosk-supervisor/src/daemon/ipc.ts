/**
 * 키오스크 ↔ daemon IPC — Windows named pipe (Bun 네이티브). 방향은 키오스크(server) ←
 * daemon(client) 이다.
 *
 * **왜 키오스크가 서버인가**: daemon 은 LocalSystem(Session 0)이라, SYSTEM 이 만든 서버 pipe 의
 * 기본 DACL 은 비승격 키오스크의 connect 를 EPERM 으로 거부한다. 반대로 사용자가 만든 pipe 엔
 * SYSTEM 이 항상 붙을 수 있다(Bun.listen 은 pipe 보안 디스크립터를 못 바꾸므로 역전이 유일하게
 * 깔끔하다). 채널 구현을 여기 가둬 kiosk-watch 는 "라인이 들어온다"만 알면 되게 한다.
 */

import { IPC_PIPE_KIOSK } from '../constants';

type LineHandler = (line: string) => void;
const RECONNECT_DELAY_MS = 3_000;

/** 키오스크 pipe 서버에 클라이언트로 붙어 수신한 각 라인을 onLine 으로 전달. 중지 함수 반환. */
export function listenKioskPipe(onLine: LineHandler): () => void {
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let socket: { end: () => void } | null = null;
  let buf = '';

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  function connect(): void {
    if (stopped) return;
    buf = '';
    Bun.connect({
      unix: IPC_PIPE_KIOSK,
      socket: {
        open(s) {
          socket = s;
        },
        data(_s, chunk) {
          buf += chunk.toString();
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) onLine(line);
            nl = buf.indexOf('\n');
          }
        },
        close() {
          socket = null;
          scheduleReconnect();
        },
        error() {
          // 키오스크(서버) 미기동/단절은 정상 경로 — close/catch 가 재시도를 잡는다.
        },
      },
      // 키오스크 서버가 아직 없으면 연결 실패 — 조용히 재시도.
    }).catch(() => scheduleReconnect());
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.end();
  };
}
