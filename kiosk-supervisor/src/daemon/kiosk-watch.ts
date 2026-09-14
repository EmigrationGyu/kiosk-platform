/**
 * 키오스크 Electron 앱 감시 (daemon 의 핵심 제품 책임). 로더가 daemon 을 감시하는 것과 같은
 * 슬라이딩 워치독: heartbeat 로 타이머 리셋 → 30초 끊기면 schtasks 재기동 → 부팅 유예로 즉시
 * 재트리거 방지. **단, 교체되는 중이면 죽이지 않는다** — heartbeat 부재의 뜻이 다르다
 * (kiosk-install.ts).
 *
 * 의존성 방향은 daemon → kiosk 뿐이다: 키오스크는 표준 사용자 권한이라 서비스를 못 건드리고,
 * 재기동 트리거는 onlogon 으로 등록된 작업 스케줄러 작업이다.
 */

import {
  KIOSK_HEARTBEAT_TIMEOUT_MS,
  KIOSK_RESTART_GRACE_MS,
  KIOSK_TASK_NAME,
} from '../constants';
import { KioskHeartbeatSchema } from '../types';
import { listenKioskPipe } from './ipc';
import { kioskInstallInProgress } from './kiosk-install';
import {
  discoverKioskLaunch,
  ensureKioskTask,
  isKioskInstalled,
  type KioskLaunch,
  killKioskProcesses,
  removeKioskTask,
} from './kiosk-task';
import { log, logError } from './log';

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 작업 스케줄러로 키오스크를 재기동.
 * launch 를 알면 exeName 으로 좀비/중복/wedged 트리를 먼저 reap 한 뒤 /run — task 가
 * 띄우지 않은 인스턴스(Squirrel 자동실행·수동)까지 확실히 정리해 중복 기동을 막는다.
 */
async function restartKiosk(launch: KioskLaunch | null): Promise<void> {
  log('kiosk heartbeat lost → restarting via schtasks');
  if (launch) {
    await killKioskProcesses(launch.exeName);
  } else {
    // launch 미수신(daemon 재시작 직후 등) — task 기동분만 best-effort 종료.
    Bun.spawn(['schtasks', '/end', '/tn', KIOSK_TASK_NAME], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
  }
  Bun.spawn(['schtasks', '/run', '/tn', KIOSK_TASK_NAME], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

/** 키오스크 감시를 시작하고, 중지 함수를 반환한다. */
export function startKioskWatch(): () => void {
  let stopped = false;
  let lastLaunch: KioskLaunch | null = null;
  let watchdog: ReturnType<typeof setTimeout>;

  const onDead = async () => {
    try {
      // heartbeat 를 한 번도 못 받았으면 디스크에서 launch 를 복원한다. 이게 없으면
      // "task 없음 → 키오스크 안 뜸 → heartbeat 없음 → task 못 만듦" 교착에 갇힌다
      // (예: 키오스크 설치 → 재부팅 → supervisor 설치). 미설치 박스면 계속 null.
      lastLaunch ??= await discoverKioskLaunch();

      // 교체되는 중이면 죽이지 않는다 — heartbeat 부재의 **뜻이 다르다**. 설치본은
      // 키오스크가 spawn 한 자식이라 `taskkill /F /T` 의 사정권에 있고, 한 번만 발화해도
      // 설치가 반쯤 풀린 채로 끊긴다. 유예는 유한하다(kiosk-install.ts 참조).
      const installing = await kioskInstallInProgress(
        lastLaunch?.username ?? null,
      );
      if (installing !== null) {
        log(`kiosk installing ${installing} → hold restart`);
      } else if (lastLaunch && !(await isKioskInstalled(lastLaunch))) {
        // 키오스크가 제거됐으면(실제 페이로드 소실) 재기동 무의미 → task teardown + 루프 정지.
        // 이후 재설치되면 heartbeat 가 watchdog 를 다시 무장시킨다(자가치유).
        log('kiosk payload gone → removing task, stop restarts');
        await removeKioskTask();
        return; // 재무장하지 않음 = 루프 종료
      } else {
        // task 가 아직 없을 수 있다(복원 경로) — restartKiosk 의 `/run` 은 task 존재를 전제.
        if (lastLaunch) await ensureKioskTask(lastLaunch);
        await restartKiosk(lastLaunch);
      }
    } catch (err) {
      logError('restart cycle error:', err);
    }
    // 재기동 후 부팅 유예 — 그 안에 heartbeat 가 오면 정상 주기로 복귀.
    // clear 먼저: await 동안 도착한 heartbeat 가 watchdog 를 재설정했을 수 있어,
    // 그걸 안 끊고 덮어쓰면 타이머가 누수돼 onDead 체인이 중복된다(재기동 폭주).
    if (!stopped) {
      clearTimeout(watchdog);
      watchdog = setTimeout(onDead, KIOSK_RESTART_GRACE_MS);
    }
  };

  // 첫 heartbeat 까지의 게이트도 동일 타임아웃으로 시작.
  watchdog = setTimeout(onDead, KIOSK_HEARTBEAT_TIMEOUT_MS);

  const stopPipe = listenKioskPipe((line) => {
    const parsed = KioskHeartbeatSchema.safeParse(safeJson(line));
    if (!parsed.success) return;
    clearTimeout(watchdog);
    watchdog = setTimeout(onDead, KIOSK_HEARTBEAT_TIMEOUT_MS);
    // 키오스크가 보고한 launch 로 자동시작/재기동 task 를 멱등 보증 (daemon=SYSTEM).
    if (parsed.data.launch) {
      lastLaunch = parsed.data.launch;
      ensureKioskTask(parsed.data.launch).catch((err) => {
        logError('ensureKioskTask error:', err);
      });
    }
  });

  return () => {
    stopped = true;
    clearTimeout(watchdog);
    stopPipe();
  };
}
