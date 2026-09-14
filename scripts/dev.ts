import { type ChildProcess, spawn } from 'node:child_process';
import { platform } from 'node:os';

type ServiceConfig = {
  name: string;
  color: string;
  cwd: string;
  cmd: string;
  args: string[];
  readyMarker: string | RegExp;
  useShell?: boolean;
};

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

/**
 * serialport 서브프로세스는 여기서 띄우지 않는다 — backend 의 processManager 가 첫 요청
 * 시점에 lazy 로 띄우고 장기 무활동이면 회수한다(프로덕션과 동일 경로). 자식들의 stdout 은
 * backend 레인에 `[cardkey-dispenser:stdout] ...` 형태로 접두사가 붙어 흘러나온다.
 */
const BACKEND: ServiceConfig = {
  name: 'backend',
  color: C.green,
  cwd: 'kiosk-backend',
  cmd: 'npm',
  args: ['run', 'start'],
  readyMarker: '[ready]',
};

const FRONTEND: ServiceConfig = {
  name: 'frontend',
  color: C.blue,
  cwd: 'kiosk-frontend',
  // use the running bun binary directly — avoids PATH resolution issues
  // (e.g. Git Bash + cmd.exe PATH mismatch on Windows)
  cmd: process.execPath,
  args: ['run', 'dev'],
  readyMarker: /Local:\s+http/,
  useShell: false,
};

const IS_WIN = platform() === 'win32';

class ServiceProcess {
  proc: ChildProcess;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private readySeen = false;

  constructor(public cfg: ServiceConfig) {
    this.readyPromise = new Promise((r) => {
      this.resolveReady = r;
    });
    this.proc = spawn(cfg.cmd, cfg.args, {
      cwd: cfg.cwd,
      shell: cfg.useShell ?? IS_WIN,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    this.wireOutput(this.proc.stdout, false);
    this.wireOutput(this.proc.stderr, true);
    this.proc.on('exit', (code) => {
      this.write(`${C.dim}(exited code=${code})${C.reset}\n`, true);
    });
  }

  private wireOutput(stream: NodeJS.ReadableStream | null, isErr: boolean) {
    if (!stream) return;
    let buf = '';
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        this.handleLine(line, isErr);
      }
    });
  }

  private handleLine(line: string, isErr: boolean) {
    this.write(line + '\n', isErr);
    if (this.readySeen) return;
    const m = this.cfg.readyMarker;
    const hit = typeof m === 'string' ? line.includes(m) : m.test(line);
    if (hit) {
      this.readySeen = true;
      this.resolveReady();
    }
  }

  private write(text: string, isErr: boolean) {
    const tag = `${this.cfg.color}${C.bold}[${this.cfg.name}]${C.reset} `;
    const stream = isErr ? process.stderr : process.stdout;
    stream.write(tag + text);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  kill(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.proc.pid || this.proc.exitCode !== null) {
        resolve();
        return;
      }
      this.proc.once('exit', () => resolve());
      if (IS_WIN) {
        spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
      } else {
        this.proc.kill('SIGTERM');
      }
    });
  }
}

let backend: ServiceProcess | null = null;
let frontend: ServiceProcess | null = null;
let shuttingDown = false;
let restartInFlight = false;

function banner(msg: string) {
  console.log(`\n${C.bold}${C.green}==>${C.reset} ${msg}\n`);
}

async function startCore() {
  backend = new ServiceProcess(BACKEND);
  await backend.ready();
  banner('backend ready');
}

async function startFrontend() {
  frontend = new ServiceProcess(FRONTEND);
  await frontend.ready();
  banner('frontend ready');
}

async function restartCore() {
  if (restartInFlight) {
    console.log(`${C.dim}(restart already in progress)${C.reset}`);
    return;
  }
  restartInFlight = true;
  try {
    // backend 를 내리면 그 자식(serialport)들도 함께 정리된다.
    banner('restarting backend');
    await (backend?.kill() ?? Promise.resolve());
    backend = null;
    await startCore();
    banner('restart complete');
  } catch (err) {
    console.error(`${C.red}restart failed:${C.reset}`, err);
  } finally {
    restartInFlight = false;
  }
}

// 단일 서비스만 죽였다 살린다 (kill → 같은 cfg 로 재spawn → ready 대기).
// 시리얼포트 한 개의 비정상 종료/복구를 흉내내, backend 의 재연결 + 재탐지(PORT_ASSIGNED)
// 경로를 dev 에서 검증하기 위한 핫키용.
async function restartOne(
  get: () => ServiceProcess | null,
  set: (p: ServiceProcess) => void,
) {
  if (restartInFlight) {
    console.log(`${C.dim}(restart already in progress)${C.reset}`);
    return;
  }
  const target = get();
  if (!target) return;
  restartInFlight = true;
  try {
    banner(`restarting [${target.cfg.name}]`);
    await target.kill();
    const fresh = new ServiceProcess(target.cfg);
    set(fresh);
    await fresh.ready();
    banner(`[${target.cfg.name}] restart complete`);
  } catch (err) {
    console.error(`${C.red}restart failed:${C.reset}`, err);
  } finally {
    restartInFlight = false;
  }
}

const restartBackend = () =>
  restartOne(
    () => backend,
    (p) => {
      backend = p;
    },
  );

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  banner('shutting down');
  await Promise.all([
    frontend?.kill() ?? Promise.resolve(),
    backend?.kill() ?? Promise.resolve(),
  ]);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

function setupHotkeys() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data: string) => {
    const key = data.toString();
    if (key === '\x03' /* Ctrl+C */ || key === 'q') {
      void shutdown();
    } else if (key === 'r') {
      void restartCore();
    } else if (key === 'b') {
      void restartBackend();
    }
  });
}

setupHotkeys();
await startCore();
await startFrontend();

console.log(
  `
${C.bold}=== dev stack ready ===${C.reset}
` +
    `${C.dim}restart:${C.reset} ${C.bold}[b]${C.reset} backend(+serialports)  ` +
    `${C.bold}[r]${C.reset} core   ${C.dim}quit:${C.reset} ${C.bold}[q]${C.reset}
` +
    `${C.dim}serialport 는 backend 가 첫 요청 때 lazy 로 띄웁니다.${C.reset}
`,
);
