/**
 * 백엔드를 대신해 serialport 자식을 띄우는 대행소. electron 을 import 하지 않는다 —
 * fork·채널 생성을 주입받아 단위 테스트 가능하게 두고, 실제 어댑터는 합성 루트가 넘긴다.
 *
 * **정책은 하나도 들고 있지 않다** — 언제 무엇을 띄우고 거둘지는 백엔드의 processManager 가
 * 정하고 여기는 fork 호출만 대행한다(utilityProcess 는 또 다른 utilityProcess 를 fork 할 수
 * 없어서 이 능력만 메인에 남는다).
 *
 * 자식의 부모는 메인이라 **백엔드가 죽어도 하드웨어 프로세스는 살아남는다** — 백엔드 업데이트가
 * 카드키·현금 방출기를 건드리지 않는다는 뜻이고, 이 토폴로지의 핵심 이득이다. 그래서 `spawn`
 * 은 **멱등**이다: 백엔드가 respawn 되어 자기 목록을 잃어도 첫 요청에서 그대로 다시 붙는다
 * (재입양 API 불필요). 멱등하지 않으면 respawn 마다 이중 spawn → COM 포트 EBUSY 가 난다.
 *
 * 메인은 백엔드↔자식 사이를 중계만 하며 메시지 모양은 **바꾸지 않는다** — 백엔드의 transport 는
 * in-process 였을 때와 완전히 같은 것을 본다.
 */
export type PortLike = {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  start(): void;
  close(): void;
};

export type ChildLike = {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  onStdout(listener: (text: string) => void): void;
  onStderr(listener: (text: string) => void): void;
  kill(): void;
};

export type ChildEvent = {
  process: string;
  event: 'exit' | 'stdout' | 'stderr';
  code?: number | null;
  text?: string;
};

type Child = {
  proc: ChildLike;
  /** 메인이 쥔 중계 포트. 백엔드가 갈리면 이것만 교체한다. */
  relay: PortLike | null;
  /** 이 자식을 띄운 런타임. 재요청이 어긋났는지 보려고 든다(`ensure` 주석). */
  execPath?: string;
};

export type SpawnService = {
  /**
   * 자식을 보장하고 백엔드에 넘길 포트를 발급한다. 이미 살아있으면 포트만 새로 만든다.
   * `execPath` 는 **그대로 전달만 한다** — 왜 그래야 하는지는 백엔드가 알고 여기는 모른다.
   *
   * **도는 자식의 런타임은 바꾸지 않는다**(런타임은 spawn 시점에 확정된다). 바꾸려면 kill 후
   * 재요청해야 하는데, 이 계약을 모르면 조용한 실패로 남으므로 어긋난 요청은 stderr 로 알린다.
   * `execPath` 는 정적 선언(`PROCESS_ARCH_OF`)에서 파생하므로, 이 알림이 뜨면 **다른 곳의 버그**다.
   */
  ensure(process: string, entry: string, execPath?: string): PortLike;
  kill(process: string): void;
  /** 백엔드가 갈릴 때 기존 중계를 끊는다 — 죽은 포트로 흘려보내지 않기 위해. */
  detachAll(): void;
};

export function createSpawnService(deps: {
  /** 자식을 실제로 띄운다(electron 어댑터). `execPath` 가 오면 그 런타임으로 띄운다. */
  fork: (entry: string, execPath?: string) => ChildLike;
  createChannel: () => { port1: PortLike; port2: PortLike };
  notify: (event: ChildEvent) => void;
}): SpawnService {
  const children = new Map<string, Child>();

  function start(process: string, entry: string, execPath?: string): Child {
    const child: Child = {
      proc: undefined as unknown as ChildLike,
      relay: null,
      execPath,
    };
    const proc = deps.fork(entry, execPath);
    child.proc = proc;

    proc.onStdout((text) => deps.notify({ process, event: 'stdout', text }));
    proc.onStderr((text) => deps.notify({ process, event: 'stderr', text }));
    proc.onExit((code) => {
      children.delete(process);
      deps.notify({ process, event: 'exit', code });
    });

    // 자식 → 백엔드 전달은 **fork 당 한 번만** 건다. attachRelay 마다 걸면 백엔드가
    // 갈린 횟수만큼 같은 응답이 중복 전달되고, in-flight 계수와 FSM 이 어긋난다.
    // 현재 relay 를 그때그때 읽으므로 포트가 갈려도 이 리스너는 그대로 쓴다.
    proc.on('message', (message) => child.relay?.postMessage(message));

    return child;
  }

  /** 백엔드용 포트를 새로 만들어 자식과 중계로 잇는다. */
  function attachRelay(child: Child): PortLike {
    child.relay?.close();

    const { port1, port2 } = deps.createChannel();
    child.relay = port2;

    // 백엔드 → 자식. 모양을 바꾸지 않는다. (자식 → 백엔드는 fork 시 한 번만 걸었다.)
    port2.on('message', (event) => child.proc.postMessage(event.data));
    port2.start();

    return port1;
  }

  return {
    ensure(process, entry, execPath) {
      const existing = children.get(process);
      if (existing) {
        if (existing.execPath !== execPath) {
          // 정책상 무시가 맞지만(위 주석) 조용하면 안 된다 — 이건 도달할 수 없는 요청이다.
          deps.notify({
            process,
            event: 'stderr',
            text: `런타임이 다른 재요청은 무시된다 (도는 것=${existing.execPath ?? '호스트'} 요청=${execPath ?? '호스트'}) — 바꾸려면 kill 후 다시 요청해야 한다`,
          });
        }
        return attachRelay(existing);
      }

      const child = start(process, entry, execPath);
      children.set(process, child);
      return attachRelay(child);
    },

    kill(process) {
      const child = children.get(process);
      if (!child) return;
      child.relay?.close();
      child.proc.kill();
      children.delete(process);
    },

    detachAll() {
      for (const child of children.values()) {
        child.relay?.close();
        child.relay = null;
      }
    },
  };
}
