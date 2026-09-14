import {
  BRIDGE_METHOD,
  type BridgeMethod,
  isBridgeCall,
  type PortMessage,
  type ProcessSpawnArgs,
} from 'kiosk-types/src/bridge/envelope';
import type { BackendProcess } from './backendProcess';
import { secureStorageService } from './secureStorageService';
import type { SpawnService } from './spawnService';

type KillArgs = { process: string };

/**
 * 백엔드가 빌려 쓰는 능력의 창구 — 요청/응답 트래픽은 여기로 흐르지 않는다. 오가는 것이
 * **부모만 할 수 있는 일**(safeStorage·프로세스 fork)로 한정되므로, 이 채널이 바빠지면
 * 프로세스 경계가 새고 있다는 신호다. 그래서 메서드는 닫힌 집합이고 types 쪽 테스트가 증가를 막는다.
 */
export function createBridgeHost(deps: {
  backend: BackendProcess;
  spawner: SpawnService;
  /** 백엔드가 렌더러 포트 구독을 걸었을 때 — 자기가 준비됐다는 선언이다. */
  onRendererPortSubscribe: () => void;
  /** 렌더러가 살아서 그리기 시작했다는 선언의 전달 — 렌더러 준비 워치독의 해제 신호. */
  onRendererAlive: () => void;
  /**
   * 백엔드가 조용해진 것을 확인하고 매니페스트 적용을 요청했을 때.
   * **백엔드가 살아남는지**를 돌려준다 — 살아남을 때만 응답이 가고, 그게 잠금 해제 신호다.
   */
  onUpdateApply: (manifest: unknown) => Promise<boolean>;
  /** 백엔드가 "이 조합이 실제로 돈다"를 확인했을 때. */
  onMarkStable: () => void;
  /** 백엔드가 계약 불일치를 관측했을 때. */
  onRollback: () => void;
  /** 백엔드가 부모에 닿기 전에 끝난 결과(받기 실패·이미 그 버전). 기록을 쓰는 것은 여전히 부모 하나다. */
  onUpdateRecord: (report: unknown) => void;
  /** "이 기록은 서버에 갔다" — `{ at }`. */
  onReported: (payload: unknown) => void;
}): void {
  const {
    backend,
    spawner,
    onRendererPortSubscribe,
    onRendererAlive,
    onUpdateApply,
    onMarkStable,
    onRollback,
    onUpdateRecord,
    onReported,
  } = deps;

  const reply = (id: string, value: unknown, transfer?: unknown[]): void =>
    backend.send(
      { kind: 'result', id, ok: true, value } satisfies PortMessage,
      transfer as never,
    );

  const fail = (id: string, error: unknown): void =>
    backend.send({
      kind: 'result',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PortMessage);

  // UPDATE_APPLY 는 위에서 따로 다룬다(비동기 응답) — 여기 닫힌 집합에서 빼야 switch 가
  // 나머지 전부를 덮는다는 것이 타입으로 보장된다.
  function dispatch(
    method: Exclude<BridgeMethod, typeof BRIDGE_METHOD.UPDATE_APPLY>,
    args: readonly unknown[],
  ) {
    switch (method) {
      case BRIDGE_METHOD.SECURE_SET: {
        const [service, account, password] = args as [string, string, string];
        secureStorageService.set(service, account, password);
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.SECURE_GET: {
        const [service, account] = args as [string, string];
        return {
          value: secureStorageService.get(service, account) as unknown,
          transfer: undefined,
        };
      }
      case BRIDGE_METHOD.SECURE_DELETE: {
        const [service, account] = args as [string, string];
        return {
          value: secureStorageService.delete(service, account) as unknown,
          transfer: undefined,
        };
      }
      case BRIDGE_METHOD.PROCESS_SPAWN: {
        const { process, entry, execPath } = args[0] as ProcessSpawnArgs;
        // 포트를 결과에 실어 보낸다 — 백엔드는 이걸로 자식과 직접 말한다(중계는 메인 내부 구현).
        const port = spawner.ensure(process, entry, execPath);
        return { value: null as unknown, transfer: [port] };
      }
      case BRIDGE_METHOD.PROCESS_KILL: {
        const { process } = args[0] as KillArgs;
        spawner.kill(process);
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.UPDATE_ROLLBACK: {
        onRollback();
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.UPDATE_RECORD: {
        onUpdateRecord(args[0]);
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.UPDATE_REPORTED: {
        onReported(args[0]);
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.UPDATE_MARK_STABLE: {
        onMarkStable();
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.RENDERER_PORT_SUBSCRIBE: {
        // 포트는 응답에 실어 보내지 않는다 — 이 시점에 렌더러가 아직 없을 수 있고,
        // 렌더러가 리로드될 때마다 새 포트가 다시 가야 하기 때문이다(일회성 조회가 아님).
        onRendererPortSubscribe();
        return { value: null as unknown, transfer: undefined };
      }
      case BRIDGE_METHOD.RENDERER_ALIVE: {
        onRendererAlive();
        return { value: null as unknown, transfer: undefined };
      }
      default: {
        // 타입은 닫힌 집합을 보장하지만, 세대가 갈린 백엔드는 이 셸이 모르는 메서드를
        // 부를 수 있다 — 조용히 삼키는 대신 실패 응답으로 드러낸다(caller 의 catch 가 받는다).
        const unknown: never = method;
        throw new Error(`모르는 브리지 메서드: ${String(unknown)}`);
      }
    }
  }

  backend.onMessage((data) => {
    const message = data as PortMessage;
    if (!isBridgeCall(message)) return;

    // 적용만 예외적으로 **비동기 응답**이다. 백엔드가 교체되면 응답할 상대가 없으므로 살아남기로
    // 결정됐을 때만 응답한다 — "응답 없음 = 너는 교체된다"가 계약이고, 그 응답이 잠금 해제 신호다.
    if (message.method === BRIDGE_METHOD.UPDATE_APPLY) {
      void onUpdateApply(message.args[0]).then((backendSurvives) => {
        if (backendSurvives) reply(message.id, null);
      });
      return;
    }

    try {
      const { value, transfer } = dispatch(
        message.method as Exclude<
          BridgeMethod,
          typeof BRIDGE_METHOD.UPDATE_APPLY
        >,
        message.args,
      );
      reply(message.id, value, transfer);
    } catch (error) {
      fail(message.id, error);
    }
  });
}
