import { Manager } from 'socket.io-client';

let manager: Manager | null = null;
const PORT = 9763;
const ORIGIN = 'http://localhost';
const PATH = '/kiosk-socket.io'; // 서버 path와 반드시 일치시켜주세요

const connectionOptions = {
  path: PATH,
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
};

function ensureSocket(): Manager {
  if (manager) {
    return manager;
  }
  manager = new Manager(`${ORIGIN}:${PORT}`, connectionOptions);
  return manager;
}

export const createSocket = (): Manager => ensureSocket();
