// Mozc IPC 스파이크 (rimeSpike.cjs 의 mozc 대응물) — 실서버 왕복 실증.
// 실행: packages/ime 에서 `bun scripts/mozcSpike.ts` (mozc_server 가 떠 있어야 함 — broker prelaunch)
//
// 확정하려는 미지수:
//  ① 요청당 연결 규약: CreateFile→MESSAGE 모드→Write 1회→Read 1회→Close(=ACK) 가 맞는가
//  ② SELECT_CANDIDATE vs SUBMIT_CANDIDATE 실동작 (조합 전진 vs 즉시 확정 — commit-on-tap UX 에 쓸 verb)
//  ③ romaji→가나 변환이 기본 설정으로 켜져 있는가 (SET_CONFIG/SET_REQUEST 불필요 여부)
// 부산물: 모든 Output raw hex 출력 → 골든 픽스처 채록.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import koffi from 'koffi';
import { projectOutput } from '../src/engine/mozc/projection';
import {
  decodeOutput,
  encodeInput,
  type MozcRequest,
} from '../src/engine/mozc/proto/commands';
import {
  decodeIpcPathInfo,
  sessionPipePathOf,
} from '../src/engine/mozc/proto/ipcPathInfo';

// Win32 바인딩 (HANDLE=int64 로 다뤄 INVALID_HANDLE_VALUE(-1) 비교를 단순화)

const kernel32 = koffi.load('kernel32.dll');
const CreateFileW = kernel32.func(
  'int64_t CreateFileW(str16 name, uint32_t access, uint32_t share, void *sa, uint32_t disposition, uint32_t flags, void *template)',
);
const SetNamedPipeHandleState = kernel32.func(
  'int SetNamedPipeHandleState(int64_t handle, uint32_t *mode, void *a, void *b)',
);
const WriteFile = kernel32.func(
  'int WriteFile(int64_t handle, const uint8_t *buf, uint32_t len, _Out_ uint32_t *written, void *overlapped)',
);
const ReadFile = kernel32.func(
  'int ReadFile(int64_t handle, uint8_t *buf, uint32_t len, _Out_ uint32_t *read, void *overlapped)',
);
const CloseHandle = kernel32.func('int CloseHandle(int64_t handle)');
const WaitNamedPipeW = kernel32.func(
  'int WaitNamedPipeW(str16 name, uint32_t timeoutMs)',
);
const GetLastError = kernel32.func('uint32_t GetLastError()');

const GENERIC_READ_WRITE = 0xc0000000;
const OPEN_EXISTING = 3;
const INVALID_HANDLE = -1;
const PIPE_READMODE_MESSAGE = 2;
const ERROR_PIPE_BUSY = 231;
const ERROR_MORE_DATA = 234;
const READ_BUF_SIZE = 1024 * 1024;

// session.ipc 발견 (서버가 파일을 잠근 채라 공유 플래그가 관건 — fs 실패 시 koffi 폴백)

const FILE_SHARE_ALL = 0x1 | 0x2 | 0x4; // READ | WRITE | DELETE
const GENERIC_READ = 0x80000000;

function readLockedFile(filePath: string): Uint8Array {
  try {
    return new Uint8Array(fs.readFileSync(filePath));
  } catch (e) {
    console.log(`  (fs.readFileSync 실패: ${e} → koffi CreateFileW 폴백)`);
    const h = CreateFileW(
      filePath,
      GENERIC_READ,
      FILE_SHARE_ALL,
      null,
      OPEN_EXISTING,
      0,
      null,
    ) as number;
    if (h === INVALID_HANDLE) {
      throw new Error(`session.ipc 열기 실패 lastError=${GetLastError()}`);
    }
    try {
      const buf = new Uint8Array(4096);
      const read = [0];
      if (!ReadFile(h, buf, buf.length, read, null)) {
        throw new Error(`session.ipc 읽기 실패 lastError=${GetLastError()}`);
      }
      return buf.subarray(0, read[0] ?? 0);
    } finally {
      CloseHandle(h);
    }
  }
}

// 파이프 왕복: 요청당 연결 (미지수 ① 검증 지점)

function callServer(pipePath: string, request: Uint8Array): Uint8Array {
  let handle = INVALID_HANDLE;
  for (let attempt = 0; attempt < 5; attempt++) {
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
      throw new Error(`파이프 열기 실패 lastError=${err}`);
    }
    WaitNamedPipeW(pipePath, 3000);
  }
  if (handle === INVALID_HANDLE) throw new Error('파이프 busy 재시도 소진');

  try {
    const mode = [PIPE_READMODE_MESSAGE];
    if (!SetNamedPipeHandleState(handle, mode, null, null)) {
      throw new Error(`MESSAGE 모드 전환 실패 lastError=${GetLastError()}`);
    }
    const written = [0];
    if (!WriteFile(handle, request, request.length, written, null)) {
      throw new Error(`쓰기 실패 lastError=${GetLastError()}`);
    }
    const buf = new Uint8Array(READ_BUF_SIZE);
    const read = [0];
    if (!ReadFile(handle, buf, buf.length, read, null)) {
      const err = GetLastError() as number;
      if (err !== ERROR_MORE_DATA) {
        throw new Error(`읽기 실패 lastError=${err}`);
      }
      throw new Error('응답이 1MB 버퍼 초과 (예상 밖)');
    }
    return buf.slice(0, read[0] ?? 0);
  } finally {
    CloseHandle(handle); // close = 서버측 ACK (mozc IPC 규약)
  }
}

// 시나리오

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const jsonOf = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));

function main(): void {
  const ipcFile = path.join(
    os.homedir(),
    'AppData',
    'LocalLow',
    'Mozc',
    'session.ipc',
  );
  console.log(`[1] session.ipc 읽기: ${ipcFile}`);
  const info = decodeIpcPathInfo(readLockedFile(ipcFile));
  console.log(`    ${jsonOf(info)}`);
  const pipePath = sessionPipePathOf(info.key);
  console.log(`    pipe = ${pipePath}`);

  let step = 0;
  const call = (label: string, request: MozcRequest) => {
    step += 1;
    const requestBytes = encodeInput(request);
    const responseBytes = callServer(pipePath, requestBytes);
    const output = decodeOutput(responseBytes);
    const projected = projectOutput(output);
    console.log(`\n[${step}] ${label}`);
    console.log(`    > req  ${hex(requestBytes)}`);
    console.log(`    < raw  ${hex(responseBytes)}`);
    console.log(`    < out  ${jsonOf(output)}`);
    console.log(`    < proj ${jsonOf(projected)}`);
    return { output, projected };
  };

  // 미지수 ③: 설정 주입 없이 romaji 가 먹는지 — CREATE_SESSION 직후 바로 타이핑.
  const created = call('CREATE_SESSION', { type: 'CREATE_SESSION' });
  const sessionId = created.output.id;
  if (sessionId === null) throw new Error('세션 id 미수신');

  // 실측: 세션은 IME off(DIRECT, status.activated=false) 로 시작 → 켜야 키가 소비된다.
  call('TURN_ON_IME', {
    type: 'SEND_COMMAND',
    sessionId,
    command: { type: 'TURN_ON_IME' },
  });

  const sendKey = (ch: string) =>
    call(`SEND_KEY '${ch}'`, {
      type: 'SEND_KEY',
      sessionId,
      key: { kind: 'codePoint', codePoint: ch.codePointAt(0) ?? 0 },
    });

  // 시나리오 A: kyou 타이핑 → (suggestion 관찰) → SPACE 변환 → 후보창 → SELECT_CANDIDATE
  for (const ch of 'kyou') sendKey(ch);
  const converted = call('SEND_KEY SPACE (변환)', {
    type: 'SEND_KEY',
    sessionId,
    key: { kind: 'special', key: 'SPACE' },
  });

  const conversionIds = converted.projected.candidateIds.filter(
    (id): id is number => id !== null,
  );
  if (conversionIds.length > 1) {
    // 미지수 ②-a: 변환 단계에서 SELECT_CANDIDATE — 확정인가 전진인가?
    call(`SELECT_CANDIDATE id=${conversionIds[1]}`, {
      type: 'SEND_COMMAND',
      sessionId,
      command: { type: 'SELECT_CANDIDATE', candidateId: conversionIds[1] ?? 0 },
    });
    // 조합이 남아있다면 SUBMIT 으로 마무리(응답으로 잔여 여부 판별).
    call('SUBMIT (잔여 확정)', {
      type: 'SEND_COMMAND',
      sessionId,
      command: { type: 'SUBMIT' },
    });
  }

  // 시나리오 B: suggestion 단계(스페이스 없이)에서 SUBMIT_CANDIDATE — commit-on-tap 경로.
  for (const ch of 'ka') sendKey(ch);
  const suggested = call('suggestion 상태 관찰', {
    type: 'SEND_KEY',
    sessionId,
    key: { kind: 'codePoint', codePoint: 'u'.codePointAt(0) ?? 0 },
  }); // "kau" → かう
  const suggestionIds = suggested.projected.candidateIds.filter(
    (id): id is number => id !== null,
  );
  if (suggestionIds.length > 0) {
    call(`SUBMIT_CANDIDATE id=${suggestionIds[0]} (suggestion 탭)`, {
      type: 'SEND_COMMAND',
      sessionId,
      command: { type: 'SUBMIT_CANDIDATE', candidateId: suggestionIds[0] ?? 0 },
    });
  } else {
    console.log('\n    (suggestion 후보 없음 — REVERT 로 정리)');
    call('REVERT', {
      type: 'SEND_COMMAND',
      sessionId,
      command: { type: 'REVERT' },
    });
  }

  // 정리 + 요청당 연결이 세션을 유지하는지 재확인(NO_OPERATION ping).
  call('NO_OPERATION (ping)', { type: 'NO_OPERATION' });
  call('DELETE_SESSION', { type: 'DELETE_SESSION', sessionId });

  console.log('\n스파이크 완료 — 위 raw hex 를 골든 픽스처로 채록할 것.');
}

main();
