import { MessageChannelMain, type WebContents } from 'electron';
import type { PortMessage } from 'kiosk-types/src/bridge/envelope';
import { mainLog } from '../mainLog';
import type { BackendProcess } from './backendProcess';

/** 렌더러가 포트를 받는 IPC 채널 이름 — preload 와 맞춰야 한다. */
export const BACKEND_PORT_CHANNEL = 'kiosk:backend-port';

export type PortBroker = {
  /** 렌더러가 새로 떴다(최초 로드·리로드·크래시 복구). */
  rendererLoaded(): void;
  /** 백엔드가 포트 구독을 걸었다 — 자기가 준비됐다고 선언한 것이다. */
  backendSubscribed(): void;
  /** 백엔드가 갈렸다 — 옛 구독은 그 프로세스와 함께 사라졌다. */
  backendGone(): void;
};

/**
 * 렌더러 ↔ 백엔드 직결 채널을 깔아준다. 메인은 배선만 하고 트래픽엔 끼지 않는다.
 *
 * **배선은 타이밍이 아니라 사실로 결정된다** — 양쪽 모두 준비됐다는 사실이 확정된 뒤에만
 * 채널을 만든다. 예전에는 fork 하자마자 포트를 밀어넣었는데 그 시점의 백엔드는 수신 준비가
 * 안 돼 포트가 조용히 사라졌고, 렌더러 요청이 **전부 타임아웃**했다. 부팅이 멀쩡했던 건
 * 렌더러 로드가 우연히 느렸기 때문이다.
 *
 * MessagePort 는 재연결이 없으므로 어느 한쪽이라도 갈리면 새 채널을 만들어 양쪽에 다시
 * 건네야 한다 — 그래서 이 브로커는 세 가지 사실 변화만 듣는다.
 */
export function createPortBroker(deps: {
  backend: BackendProcess;
  /** 배선 대상 렌더러. 준비되지 않았으면 null 을 돌려준다. */
  getWebContents: () => WebContents | null;
}): PortBroker {
  const { backend, getWebContents } = deps;
  let backendReady = false;

  function wireIfBothReady(): void {
    if (!backendReady) {
      mainLog('info', '배선 보류 — 백엔드 준비 선언 대기 중');
      return;
    }
    const contents = getWebContents();
    if (!contents || contents.isDestroyed()) {
      mainLog('info', '배선 보류 — 렌더러 준비 대기 중');
      return;
    }

    const { port1, port2 } = new MessageChannelMain();
    backend.send({ kind: 'port', tag: 'renderer' } satisfies PortMessage, [
      port1,
    ]);
    contents.postMessage(BACKEND_PORT_CHANNEL, null, [port2]);
    mainLog('info', '렌더러↔백엔드 포트 배선 완료');
  }

  return {
    rendererLoaded: wireIfBothReady,
    backendSubscribed() {
      mainLog('info', '백엔드 포트 구독 수신');
      backendReady = true;
      wireIfBothReady();
    },
    backendGone() {
      mainLog('info', '백엔드 교체 — 구독 무효화');
      backendReady = false;
    },
  };
}
