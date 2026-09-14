// mozc 세션 파이프 I/O (impure shell) — 스파이크(scripts/mozcSpike.ts)에서 검증한
// koffi kernel32 바인딩/시퀀스 그대로. Node net 은 byte-mode 라 mozc 의
// PIPE_TYPE_MESSAGE(길이 프리픽스 없음, 메시지 경계=프레이밍)에 부적합해 Win32 직행한다.
// 규약(실측): 요청당 연결 — CreateFile → MESSAGE 모드 → Write 1회 → Read 1회 → Close(=ACK).
// 연결이 끊겨도 서버측 세션은 유지된다.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_DATA_DIR } from 'kiosk-types';
import koffi from 'koffi';

// 바인딩은 첫 왕복 때 지연 로드 — 모듈 스코프에서 kernel32 를 열면 비-Windows(CI 리눅스)
// 에서 import 만으로 즉사해 skipIf 가드가 닿기 전에 스위트가 죽는다(rime 의 loadRime 과 같은 idiom).
// 상태가 없어 HMR 재평가로 재바인딩돼도 무해(koffi lib 캐시).
function bindKernel32() {
  const kernel32 = koffi.load('kernel32.dll');
  return {
    CreateFileW: kernel32.func(
      'int64_t CreateFileW(str16 name, uint32_t access, uint32_t share, void *sa, uint32_t disposition, uint32_t flags, void *template)',
    ),
    SetNamedPipeHandleState: kernel32.func(
      'int SetNamedPipeHandleState(int64_t handle, uint32_t *mode, void *a, void *b)',
    ),
    WriteFile: kernel32.func(
      'int WriteFile(int64_t handle, const uint8_t *buf, uint32_t len, _Out_ uint32_t *written, void *overlapped)',
    ),
    ReadFile: kernel32.func(
      'int ReadFile(int64_t handle, uint8_t *buf, uint32_t len, _Out_ uint32_t *read, void *overlapped)',
    ),
    CloseHandle: kernel32.func('int CloseHandle(int64_t handle)'),
    WaitNamedPipeW: kernel32.func(
      'int WaitNamedPipeW(str16 name, uint32_t timeoutMs)',
    ),
    GetLastError: kernel32.func('uint32_t GetLastError()'),
  };
}

let cachedKernel32: ReturnType<typeof bindKernel32> | null = null;
const win32 = (): ReturnType<typeof bindKernel32> =>
  (cachedKernel32 ??= bindKernel32());

const GENERIC_READ_WRITE = 0xc0000000;
const OPEN_EXISTING = 3;
const INVALID_HANDLE = -1; // HANDLE 을 int64 로 다루면 INVALID_HANDLE_VALUE 비교가 -1 로 단순해진다
const PIPE_READMODE_MESSAGE = 2;
const ERROR_PIPE_BUSY = 231;
const BUSY_WAIT_MS = 3000;
const BUSY_RETRIES = 5;
// 실측 최대 응답(all_candidate_words 포함)이 수 KB 수준 — 64KB 면 여유가 크다.
const READ_BUF_SIZE = 64 * 1024;

/** 서버가 유저프로필에 남기는 세션 IPC 정보 파일(실측: LocalLow — LOCALAPPDATA 아님). */
export function resolveMozcIpcFile(): string {
  return path.join(os.homedir(), 'AppData', 'LocalLow', 'Mozc', 'session.ipc');
}

/**
 * session.ipc 읽기. 서버가 파일을 write-lock 으로 잡고 있지만 bun fs 의 기본 공유
 * 플래그(READ|WRITE|DELETE)로 읽힌다(스파이크 실측 — 폴백 불필요).
 */
export function readIpcFile(filePath: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(filePath));
}

/** 캐리셋(ensure 가 ~/.kiosk/mozc 에 펼침)의 broker 경로. */
export function resolveMozcBrokerPath(): string {
  return path.join(os.homedir(), LOCAL_DATA_DIR, 'mozc', 'mozc_broker.exe');
}

/**
 * broker prelaunch — mozc_server 직접 스폰은 불가(서버가 impersonation thread token 을
 * 요구해 bare 스폰은 run-level DENY 로 침묵 즉사)라서 공식 launcher 인 broker 를 경유한다.
 * broker 는 서버/렌더러를 샌드박스 스폰한 뒤 곧장 종료하므로 동기 블록이 짧다.
 * 중복 기동은 서버측 server.lock 이 막아 멱등하다.
 */
export function spawnMozcBroker(brokerPath: string): void {
  const result = spawnSync(brokerPath, ['--mode=prelaunch_processes'], {
    stdio: 'ignore',
    timeout: 10_000,
  });
  if (result.error) throw result.error;
}

/** 동기 대기 — 엔진 계약(ImeEngine)이 동기라 broker 직후 파이프 폴링에 쓴다. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 요청 1건 왕복(동기). 실패는 Error throw — 호출자(MozcEngine)가 경계에서 잡아
 * 파이프 리셋 + 빈 결과로 수렴시킨다.
 */
export function callMozcServer(
  pipePath: string,
  request: Uint8Array,
): Uint8Array {
  const {
    CreateFileW,
    SetNamedPipeHandleState,
    WriteFile,
    ReadFile,
    CloseHandle,
    WaitNamedPipeW,
    GetLastError,
  } = win32();

  let handle = INVALID_HANDLE;
  for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
    handle = CreateFileW(
      pipePath,
      GENERIC_READ_WRITE,
      0,
      null,
      OPEN_EXISTING,
      0,
      null,
    ) as number;
    if (handle !== INVALID_HANDLE) break;
    const err = GetLastError() as number;
    if (err !== ERROR_PIPE_BUSY) {
      throw new Error(`[MozcPipe] 파이프 열기 실패 lastError=${err}`);
    }
    // 다른 클라이언트(TIP 등)가 인스턴스를 점유 중 — 슬롯이 빌 때까지 대기 후 재시도.
    WaitNamedPipeW(pipePath, BUSY_WAIT_MS);
  }
  if (handle === INVALID_HANDLE) {
    throw new Error('[MozcPipe] 파이프 busy 재시도 소진');
  }

  try {
    const mode = [PIPE_READMODE_MESSAGE];
    if (!SetNamedPipeHandleState(handle, mode, null, null)) {
      throw new Error(
        `[MozcPipe] MESSAGE 모드 전환 실패 lastError=${GetLastError()}`,
      );
    }
    const written = [0];
    if (!WriteFile(handle, request, request.length, written, null)) {
      throw new Error(`[MozcPipe] 쓰기 실패 lastError=${GetLastError()}`);
    }
    const buf = new Uint8Array(READ_BUF_SIZE);
    const read = [0];
    if (!ReadFile(handle, buf, buf.length, read, null)) {
      throw new Error(`[MozcPipe] 읽기 실패 lastError=${GetLastError()}`);
    }
    return buf.slice(0, read[0] ?? 0);
  } finally {
    CloseHandle(handle); // close = 서버측 ACK (mozc IPC 규약)
  }
}
