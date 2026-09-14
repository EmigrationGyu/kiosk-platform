/**
 * 키오스크 자동시작/재기동 task 보증 (daemon 이 소유).
 *
 * 왜 daemon 인가: electron Squirrel 훅은 비승격 per-user 컨텍스트라 일부 머신에서
 * `schtasks /create` 가 Access denied 로 거부된다. daemon 은 LocalSystem 이라 권한 문제가 없다.
 * 키오스크가 heartbeat 로 launch 정보를 보내면 daemon 이 멱등 생성/보수한다 — 설치 순서 무관.
 *
 * **launch 의 출처가 둘인 이유**: heartbeat 만이 출처면 교착이 생긴다(task 가 없으면 로그온 시
 * 키오스크가 안 뜨고, 안 뜨면 heartbeat 도 없다. Squirrel 은 숏컷만 만들고 Startup 항목이 없어
 * 부팅 자동시작은 오직 이 task). 그래서 heartbeat 를 한 번도 못 받았을 땐 `discoverKioskLaunch`
 * 로 디스크에서 설치본을 찾아 복원한다.
 */

import { readdir } from 'node:fs/promises';
import {
  KIOSK_INSTALL_DIR_NAME,
  KIOSK_TASK_NAME,
  USER_PROFILES_DIR,
} from '../constants';
import { log, logError } from './log';

export type KioskLaunch = {
  updateExe: string;
  exeName: string;
  username: string;
};

// 이번 세션에서 이미 시도한 /tr — 매 heartbeat(5초)마다 schtasks 를 때리지 않기 위한 디둡.
let lastEnsured: string | null = null;

/** Update.exe stub 으로 키오스크를 실행하는 schtasks /tr 문자열 (버전 불변). */
function buildTaskRun(launch: KioskLaunch): string {
  return `"${launch.updateExe}" --processStart "${launch.exeName}"`;
}

/**
 * Kiosk task 가 없거나 /tr 이 바뀌었으면 (재)생성한다. SYSTEM 권한이라 거부 없음.
 * 키오스크 바이너리(Update.exe)가 디스크에 있을 때만 — 미설치면 조용히 건너뛴다(다음
 * heartbeat 에 재시도하므로 daemon 이 먼저 떠도 안전).
 */
export async function ensureKioskTask(launch: KioskLaunch): Promise<void> {
  const tr = buildTaskRun(launch);
  if (tr === lastEnsured) return; // 이미 시도함 — no-op

  if (!(await Bun.file(launch.updateExe).exists())) return; // 키오스크 미설치 — 재시도 여지 남김

  lastEnsured = tr; // 이 세션에선 이 tr 로 1회만 시도 (영구 실패 시 5초 스팸 방지; daemon 재시작 시 재시도)

  // /ru <user> /it: 사용자 세션에 대화형 실행(암호 불필요). /f: 멱등 덮어쓰기.
  const proc = Bun.spawn(
    [
      'schtasks',
      '/create',
      '/tn',
      KIOSK_TASK_NAME,
      '/tr',
      tr,
      '/sc',
      'onlogon',
      '/ru',
      launch.username,
      '/it',
      '/f',
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const code = await proc.exited;
  if (code === 0) {
    log(`ensured kiosk task ${KIOSK_TASK_NAME} (user=${launch.username})`);
  } else {
    const err = (await new Response(proc.stderr).text()).trim();
    logError(`ensure kiosk task failed (code ${code}): ${err}`);
  }
}

/**
 * 키오스크가 실제로 설치돼 있는지. Update.exe 는 제거 후에도 잔존하므로 그걸로 판정하면
 * 안 되고, Squirrel 페이로드 `<root>\app-*\<exeName>` 존재로 본다. 잘못된 false(미설치
 * 오판)는 멀쩡한 task 를 지워버리니, 확실히 없을 때만 false 를 돌려준다(보수적).
 */
export async function isKioskInstalled(launch: KioskLaunch): Promise<boolean> {
  const root = launch.updateExe.slice(0, launch.updateExe.lastIndexOf('\\'));
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return false; // root 자체가 없으면 미설치
  }
  for (const name of entries) {
    if (!name.startsWith('app-')) continue;
    if (await Bun.file(`${root}\\${name}\\${launch.exeName}`).exists()) {
      return true;
    }
  }
  return false;
}

// Squirrel 페이로드가 아닌 것들 — app-* 안의 exe 후보에서 제외.
const NON_PAYLOAD_EXES = new Set(['update.exe', 'squirrel.exe']);
// 실제 사람이 로그온하지 않는 내장 프로필 — 키오스크가 설치될 리 없다.
const SKIP_PROFILES = new Set([
  'public',
  'default',
  'default user',
  'all users',
]);

/** `<root>\app-*\<exe>` 에서 페이로드 실행 파일명을 찾는다. 없으면 null(미설치/제거됨). */
async function findPayloadExe(root: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.startsWith('app-')) continue;
    let inner: string[];
    try {
      inner = await readdir(`${root}\\${name}`);
    } catch {
      continue; // app-* 가 파일이거나 읽기 실패 — 다음 후보로
    }
    const exe = inner.find((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith('.exe') && !NON_PAYLOAD_EXES.has(lower);
    });
    if (exe) return exe; // 버전이 여러 개여도 exeName 은 동일 — 첫 페이로드로 충분
  }
  return null;
}

/**
 * heartbeat 없이 디스크에서 키오스크 launch 를 복원한다 (교착 탈출용).
 * 사용자 프로필을 훑어 Squirrel per-user 설치본(Update.exe + app-*\<exe>)을 찾는다.
 * daemon 은 LocalSystem 이라 남의 프로필도 읽을 수 있다. 없으면 null — 진짜 미설치 박스.
 */
export async function discoverKioskLaunch(): Promise<KioskLaunch | null> {
  let profiles: string[];
  try {
    profiles = await readdir(USER_PROFILES_DIR);
  } catch {
    return null;
  }
  for (const username of profiles) {
    if (SKIP_PROFILES.has(username.toLowerCase())) continue;
    const root = `${USER_PROFILES_DIR}\\${username}\\AppData\\Local\\${KIOSK_INSTALL_DIR_NAME}`;
    const updateExe = `${root}\\Update.exe`;
    if (!(await Bun.file(updateExe).exists())) continue; // 프로필 아닌 항목(desktop.ini)도 여기서 걸러짐
    const exeName = await findPayloadExe(root);
    if (!exeName) continue; // stub 만 남은 제거 흔적 — 페이로드가 있어야 실행 가능
    log(`discovered kiosk install: user=${username} exe=${exeName}`);
    return { updateExe, exeName, username };
  }
  return null;
}

/**
 * 키오스크 프로세스를 강제 종료(좀비/중복/wedged reap). 없으면 비-0 종료, 무해.
 *
 * **`/T` 를 쓰지 않는다 — 자식 트리에 우리를 갈아치우는 설치본이 들어 있다.** 프로덕션에서
 * 키오스크의 자식은 전부 `utilityProcess.fork` 라 이미지명이 부모와 같아 `/IM` 하나로 트리
 * 전체가 걸린다. `/T` 가 추가로 잡는 것은 키오스크가 spawn 한 `*-Setup.exe` 뿐이고, 그것까지
 * 죽여서 1.26.0 설치가 반쯤 풀린 채 끊겼다(실측 2026-08-28).
 */
export function killArgs(exeName: string): string[] {
  return ['taskkill', '/F', '/IM', exeName];
}

export async function killKioskProcesses(exeName: string): Promise<void> {
  await Bun.spawn(killArgs(exeName), {
    stdout: 'ignore',
    stderr: 'ignore',
  }).exited;
}

/** Kiosk task 제거 (키오스크 제거 감지 시 teardown). 재설치되면 ensure 가 다시 만든다. */
export async function removeKioskTask(): Promise<void> {
  lastEnsured = null; // 재설치 시 재생성 허용
  await Bun.spawn(['schtasks', '/delete', '/tn', KIOSK_TASK_NAME, '/f'], {
    stdout: 'ignore',
    stderr: 'ignore',
  }).exited;
  log(`removed kiosk task ${KIOSK_TASK_NAME}`);
}
