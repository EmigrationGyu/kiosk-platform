import { Server } from 'socket.io';

let io: Server | null = null;
const PORT = 9763;

export function createSocketServer(): Server {
  if (io) {
    return io;
  }

  io = new Server(PORT, {
    // 인증 캡처 이미지(전면 + 신분증 data URL)가 오가므로 기본 1MB 로는 부족하다.
    // 다인원 인증(전면 1 + 신분증 N)까지 한 프레임에 담길 수 있어 넉넉히 둔다.
    maxHttpBufferSize: 16 * 1024 * 1024,
    cors: {
      origin(origin, callback) {
        if (!origin || origin === 'null') {
          // allow Electron file:// and non-browser clients (no Origin)
          return callback(null, true);
        }
        if (origin === 'http://localhost:5173') {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/kiosk-socket.io',
  });

  return io;
}
