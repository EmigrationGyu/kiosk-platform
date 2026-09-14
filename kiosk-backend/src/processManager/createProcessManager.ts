import {
  decodeLogLine,
  type LogLevel,
  type LogRecord,
  type SerialportProcess,
} from 'kiosk-types';
import { createQuiescenceWaiter } from '../update/quiescence';
import { type ActivityLog, createActivityLog } from './activity';
import { processLogRecord } from './logMirror';
import {
  IDLE_REAP_INTERVAL_MS,
  IDLE_SHUTDOWN_MS,
  isLazy,
  isPersistent,
  MANAGED_PROCESSES,
} from './policy';
import type { ProcessHandle, ProcessManager, Spawner } from './types';

export type ProcessManagerDeps<C> = {
  spawner: Spawner<C>;
  now?: () => number;
  /**
   * 로그 레코드가 나가는 구멍 — 부모가 대신 남기는 spawn·crash 줄과, 자식이 stdout 으로 흘려보낸
   * 자기 로그가 **같은 곳으로** 간다. 주입된 효과라 이 모듈은 그 너머를 모른다.
   */
  onLog?: (record: LogRecord) => void;
  /**
   * "이 프로세스는 조용해도 거두지 않는다" 판정. 기본은 정책 모듈(`policy.isPersistent`).
   * 주입 가능한 이유는 이것이 **정책**이지 매니저의 성질이 아니기 때문이다 — 집합이 비어
   * 있는 배포에서도 거두지 않는 분기 자체는 검증되어야 한다.
   */
  isPersistent?: (process: SerialportProcess) => boolean;
};

/**
 * 하드웨어 서브프로세스의 수명 관리 — spawn 메커니즘을 모르는 채로 **언제 띄우고 언제 거둘지**만
 * 결정한다. 실제 fork 는 주입된 Spawner 가 한다.
 *
 * 종료는 세 갈래로 구분한다(이 구분이 없으면 정상 종료 때마다 자식들이 "부팅 크래시 의심" 에러를 남겨
 * 진짜 크래시를 찾을 때 노이즈가 된다): reaper 종료 → 활동 레코드 정리 / 앱 종료 → 조용히 /
 * 그 외 → 크래시(자동 재시작하지 않고 다음 요청 때 다시 띄운다).
 *
 * 크래시 후 자동 재시작을 두지 않는 이유: on-demand 재spawn 과 겹쳐 이중 spawn(고아 프로세스 →
 * COM 포트 EBUSY)이 되고, 활동 레코드 없는 프로세스를 reaper 가 회수 못 해 영구 keep-alive 가 된다.
 */
export function createProcessManager<C>(
  deps: ProcessManagerDeps<C>,
): ProcessManager<C> {
  const now = deps.now ?? Date.now;
  const persistent = deps.isPersistent ?? isPersistent;
  const activity: ActivityLog = createActivityLog(now);
  const quiescence = createQuiescenceWaiter({ activity });
  const live = new Map<SerialportProcess, ProcessHandle<C>>();
  /** reaper 가 의도적으로 내린 프로세스 — exit 핸들러가 크래시와 구분하는 근거. */
  const reaperKills = new Set<SerialportProcess>();
  /** 자식이 (재)기동될 때 다시 밀어줄 상태가 있는 쪽들. */
  const spawnListeners: ((process: SerialportProcess) => void)[] = [];
  let shuttingDown = false;
  let reaperTimer: ReturnType<typeof setInterval> | null = null;

  const log = (process: SerialportProcess, level: LogLevel, message: string) =>
    deps.onLog?.(processLogRecord(process, level, message));

  /**
   * 자식의 stdout 은 두 가지가 섞여 흐른다 — 자기 로그와 그 밖의 출력(`[ready]`·번들러 잡음).
   * 프레이밍된 줄만 로그로 걷어내고 나머지는 콘솔로 흘린다.
   */
  function onStdoutChunk(process: SerialportProcess, chunk: string): void {
    for (const line of chunk.split('\n')) {
      if (!line) continue;
      const record = decodeLogLine(line);
      if (record) deps.onLog?.(record);
      else console.log(`[${process}:stdout] ${line}`);
    }
  }

  function wire(process: SerialportProcess, child: ProcessHandle<C>): void {
    child.onStdout((text) => onStdoutChunk(process, text));
    child.onStderr((text) => {
      console.error(`[${process}:stderr] ${text}`);
      // 부팅 크래시(네이티브 로드 실패 등)는 대개 stderr 로만 나온다 — 파일로 미러.
      log(process, 'error', `stderr: ${text}`);
    });
    child.onExit((code) => {
      live.delete(process);

      // 세 갈래 모두 파일에 남긴다 — 패키징된 앱에선 콘솔이 보이지 않아, 이 로그가
      // 종료가 어떤 종류였는지 확인할 수 있는 유일한 창구다.
      if (shuttingDown) {
        log(process, 'info', `앱 종료로 함께 내려감 code=${code}`);
        return;
      }

      if (reaperKills.has(process)) {
        reaperKills.delete(process);
        activity.clear(process);
        console.log(`[${process}] idle shutdown (code=${code})`);
        log(
          process,
          'info',
          `idle 회수 code=${code} — 다음 요청 때 재spawn 된다`,
        );
        return;
      }

      // 활동 레코드는 남겨둔다 — in-flight 였던 요청은 transport timeout 이 markEnd 로
      // 균형을 맞추고, 살아있는 프로세스 없는 레코드는 reaper 가 정리한다.
      console.error(`[${process}] exited unexpectedly code=${code}`);
      log(
        process,
        'error',
        `예기치 않은 종료 code=${code} — 부팅 크래시 의심 (요청은 오는데 응답 타임아웃이면 이 라인 확인)`,
      );
    });
  }

  function ensure(process: SerialportProcess): ProcessHandle<C> {
    const existing = live.get(process);
    if (existing) return existing;

    // 종료 중 spawn 하면 부모가 먼저 죽어 고아 프로세스가 남는다.
    if (shuttingDown) {
      throw new Error(`Cannot spawn ${process} while shutting down`);
    }

    const child = deps.spawner.spawn(process);
    live.set(process, child);
    wire(process, child);
    startReaper();

    // 자식은 방금 **새로 태어났다** — 부모가 쥐고 있던 상태(자격증명 등)를 다시 밀어줘야
    // 하는 쪽이 있으면 여기서 안다. 구독으로 두는 이유는 방향 때문이다: 이 모듈이
    // 소비자를 import 하면 트랜스포트를 거쳐 자기 자신으로 돌아온다.
    for (const listener of spawnListeners) listener(process);

    return child;
  }

  function reapIdle(at: number): SerialportProcess[] {
    const reaped: SerialportProcess[] = [];
    for (const process of activity.idleSince(at, IDLE_SHUTDOWN_MS)) {
      // 자기 타이머로 일하는 프로세스는 IPC 가 조용해도 놀고 있는 게 아니다.
      if (persistent(process)) continue;
      const child = live.get(process);
      if (!child) {
        // 활동 레코드는 있는데 살아있는 프로세스가 없다 — 레코드만 정리.
        activity.clear(process);
        continue;
      }
      reaperKills.add(process);
      child.kill();
      reaped.push(process);
    }
    return reaped;
  }

  function startReaper(): void {
    if (reaperTimer) return;
    reaperTimer = setInterval(() => reapIdle(now()), IDLE_REAP_INTERVAL_MS);
    // 회수 타이머가 프로세스 종료를 붙잡지 않도록.
    reaperTimer.unref?.();
  }

  return {
    ensure,
    onSpawned(listener) {
      spawnListeners.push(listener);
    },
    reapIdle,
    startReaper,
    startEager() {
      for (const process of MANAGED_PROCESSES) {
        if (!isLazy(process)) ensure(process);
      }
    },
    stopAll() {
      shuttingDown = true;
      if (reaperTimer) clearInterval(reaperTimer);
      reaperTimer = null;
      for (const child of live.values()) child.kill();
      live.clear();
    },
    markRequestStart: activity.markStart,
    // markEnd 는 응답·타임아웃 모든 종료 경로를 지나므로, 정숙 알림을 여기 하나에 건다.
    markRequestEnd: (process, ending) => {
      activity.markEnd(process, ending);
      quiescence.notifySettled();
    },
    allAnswered: activity.allAnswered,
    awaitQuiescence: quiescence.await,
  };
}
