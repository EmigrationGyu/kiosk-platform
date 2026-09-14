import { bridge } from '@bridge/Bridge';
import {
  BRIDGE_METHOD,
  contractMismatchCause,
  isPortRequest,
  type PortMessage,
} from 'kiosk-types';
import { LogService } from 'src/service/LogService';
import type { z } from 'zod';
import { ERROR_CODE } from '../../../constant/ErrorCodes';
import type { SocketHandler, SocketRequest } from '../../../types/Socket';
import { processRequest } from '../processRequest';
import type { IChannel } from '../types';

/**
 * 백엔드가 electron 메인 밖(자식 프로세스)에서 돌 때의 채널.
 *
 * `ipcMain.handle` 은 채널명이 라우팅을 대신했지만 포트는 하나뿐이라, 주소(`namespace+event`)
 * 로 직접 라우팅한다. 네임스페이스마다 Channel 인스턴스가 생기지만 **포트는 공유**이므로
 * 라우팅 테이블을 모듈이 소유하고 각 Channel 이 자기 주소를 등록한다.
 */
type Route = {
  schema: z.ZodSchema | undefined;
  handler: SocketHandler<any, any> | undefined;
  event: string;
};

const routes = new Map<string, Route>();
let subscribed = false;

/**
 * 백엔드 재기동·재배선 때마다 새 포트가 온다 — 라우팅 테이블은 그대로 두고 포트만 갈아낀다.
 *
 * **구독을 먼저 걸고 부모에게 알린다.** 부모가 "자식이 떴을 것"이라 추측해 포트를 밀어넣던
 * 시절엔, 아직 여기 도달하지 못한 백엔드에게 포트가 도착해 조용히 사라졌다(재기동 직후
 * 모든 요청이 타임아웃). 이제 준비됐다는 사실을 자식이 선언하므로 순서가 확정된다.
 */
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;

  bridge().onRendererPort((next) => {
    LogService.getInstance().info('[포트] 렌더러 포트 수신 — 요청 수신 시작');
    // 세대마다 자기 포트로 회신한다 — 보관하지 않으므로 옛 포트로 새는 일이 없다.
    next.on('message', async (event) => {
      const message = event.data as PortMessage;
      if (!isPortRequest(message)) return;

      const route = routes.get(message.address);
      const request: SocketRequest<unknown> = {
        id: message.id,
        body: message.body,
      };

      // 등록되지 않은 주소 = 이 백엔드가 모르는 이벤트. 일반 500 이 아니라 계약 불일치로
      // 올려야 상대가 "재시도"와 "되감기"를 구별할 수 있다.
      const payload = route
        ? await processRequest(
            route.event,
            request,
            route.schema,
            route.handler,
          )
        : {
            id: message.id,
            code: ERROR_CODE.NOT_IMPLEMENTED,
            ok: false as const,
            cause: contractMismatchCause(
              `백엔드가 모르는 주소입니다: ${message.address}`,
            ),
          };

      next.postMessage({ kind: 'response', id: message.id, payload });
    });
  });

  // 구독을 건 **뒤에** 알린다 — 순서가 뒤집히면 첫 포트를 놓친다.
  // (요청 자체는 메인이 수신 시점에 남기므로 여기선 찍지 않는다 — 한 사건에 로그 하나.)
  void bridge().call(BRIDGE_METHOD.RENDERER_PORT_SUBSCRIBE);
}

export class Channel implements IChannel {
  namespace: string;
  private schemas: Record<string, z.ZodSchema>;

  constructor(namespace: string, schemas: Record<string, z.ZodSchema>) {
    this.namespace = namespace;
    this.schemas = schemas;
    ensureSubscribed();
  }

  public on<TRequest = unknown, TResponse = unknown>(
    event: string,
    callback: SocketHandler<TRequest, TResponse>,
  ) {
    const address = `${this.namespace}${event.startsWith('/') ? event : `/${event}`}`;
    if (routes.has(address)) {
      throw new Error(`Event ${event} already served`);
    }
    routes.set(address, {
      schema: this.schemas[event],
      handler: callback as SocketHandler<any, any>,
      event,
    });
  }

  // 이 토폴로지에서 백엔드 교체는 프로세스 respawn 이라 핸들러 교체 경로가 존재하지 않는다.
  // 도달했다면 빌드 환경 가정이 깨진 것이므로 fail-loud.
  public replaceHandlers(
    _handlers: Map<string, SocketHandler<unknown, unknown>>,
  ): void {
    throw new Error(
      'Channel.replaceHandlers: 자식 프로세스 토폴로지에는 없는 경로입니다 (교체 = respawn)',
    );
  }
}

/** 테스트에서 라우팅 테이블을 초기화하기 위한 훅. */
export function __resetRoutes(): void {
  routes.clear();
  subscribed = false;
}
