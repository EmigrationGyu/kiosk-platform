/**
 * 백엔드 자식 프로세스의 수명 소유자. 메인 안에서 돌 때는 "교체 = 앱 재기동"이었지만 자식이
 * 되면 **kill + fork** 로 끝난다 — teardown 을 OS 가 하므로 정리 목록을 사람이 관리할 필요가
 * 없고, 그게 이 토폴로지의 존재 이유다.
 *
 * electron 을 import 하지 않는다 — fork 를 주입받아 단위 테스트 가능하게 유지한다(spawnService 와 같은 모양).
 */
export type BackendChildLike = {
  postMessage(message: unknown, transfer?: unknown[]): void;
  onMessage(listener: (data: unknown) => void): void;
  /** 자식이 실제로 떴을 때. 이 전에 보낸 메시지는 상대가 없다. */
  onSpawn(listener: () => void): void;
  onExit(listener: (code: number | null) => void): void;
  onStdout(listener: (text: string) => void): void;
  onStderr(listener: (text: string) => void): void;
  kill(): void;
};

export type BackendProcess = {
  start(): void;
  /** 이미 떠 있으면 내리고 다시 띄운다. 업데이트 적용 경로. */
  restart(): void;
  send(message: unknown, transfer?: unknown[]): void;
  onMessage(listener: (data: unknown) => void): void;
  /** 자식이 **뜬 뒤** 불린다 — 포트 재배선의 트리거. */
  onStarted(listener: () => void): void;
  kill(): void;
};

type Generation = {
  child: BackendChildLike;
  spawned: boolean;
  /** spawn 이전에 도착한 송신. 상대가 없으므로 담아뒀다가 spawn 직후 흘려보낸다. */
  outbox: { message: unknown; transfer?: unknown[] }[];
};

export function createBackendProcess(deps: {
  fork: () => BackendChildLike;
  /** 예기치 않게 죽었을 때 자동으로 다시 띄울지. */
  autoRestart?: boolean;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onUnexpectedExit?: (code: number | null) => void;
}): BackendProcess {
  let current: Generation | null = null;
  let stopping = false;
  const messageListeners: ((data: unknown) => void)[] = [];
  const startedListeners: (() => void)[] = [];

  function spawn(): void {
    const child = deps.fork();
    const generation: Generation = { child, spawned: false, outbox: [] };
    current = generation;

    child.onStdout((text) => deps.onStdout?.(text));
    child.onStderr((text) => deps.onStderr?.(text));
    child.onMessage((data) => {
      for (const listener of messageListeners) listener(data);
    });

    child.onExit((code) => {
      // **이미 교체된 이전 세대의 exit 는 무시한다.** kill 후 exit 는 비동기로 도착하는데,
      // 그 사이 재기동이 새 프로세스를 띄워두면 플래그로는 구별할 수 없다. 실제로 한 번의
      // 재기동이 백엔드 두 개를 만들었다(실측: 15~27ms 간격 이중 기동).
      if (current !== generation) return;

      current = null;
      if (stopping) return;
      deps.onUnexpectedExit?.(code);
      if (deps.autoRestart) spawn();
    });

    // **배선은 자식이 뜬 뒤에 한다.** fork 직후 동기적으로 알리면 아직 상대가 없는 상태로 포트를
    // postMessage 하게 되고 그 포트는 조용히 사라진다 — 렌더러는 요청을 쏘지만 백엔드엔 도착하지
    // 않아 **전부 타임아웃**한다(실측: 재기동 직후 로그·하드웨어 요청이 모두 죽었다).
    child.onSpawn(() => {
      if (current !== generation) return;
      generation.spawned = true;
      for (const { message, transfer } of generation.outbox) {
        child.postMessage(message, transfer);
      }
      generation.outbox.length = 0;
      for (const listener of startedListeners) listener();
    });
  }

  return {
    start: spawn,
    restart() {
      // 옛 프로세스를 내리고 즉시 새로 띄운다. 옛 exit 는 위 동일성 판정에서 걸러진다.
      current?.child.kill();
      spawn();
    },
    send(message, transfer) {
      if (!current) return;
      // spawn 전이면 담아둔다 — 렌더러 로드가 자식 기동을 앞지르는 경우가 있다.
      if (!current.spawned) {
        current.outbox.push({ message, transfer });
        return;
      }
      current.child.postMessage(message, transfer);
    },
    onMessage(listener) {
      messageListeners.push(listener);
    },
    onStarted(listener) {
      startedListeners.push(listener);
    },
    kill() {
      stopping = true;
      current?.child.kill();
      current = null;
    },
  };
}
