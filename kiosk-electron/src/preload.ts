import { type IpcRendererEvent, ipcRenderer } from 'electron';
import { RENDERER_PORT_MESSAGE } from 'kiosk-types/src/bridge/envelope';

/** 메인이 백엔드 직결 포트를 보낼 때 쓰는 IPC 채널 — portBroker 와 맞춰야 한다. */
const BACKEND_PORT_CHANNEL = 'kiosk:backend-port';

/**
 * preload 가 하는 일은 **포트를 페이지로 건네는 것 하나뿐**이다. 예전에는 `ipcRenderer.invoke`
 * 를 노출해 렌더러가 메인을 거쳐 백엔드와 말했지만, 백엔드가 메인 밖으로 나가면서 그 상대가
 * 사라졌다. `contextBridge` 로는 MessagePort 를 노출할 수 없어(전송 가능 객체라 복제되지 않는다)
 * `window.postMessage` 의 transfer 로 건넨다. 백엔드가 재기동되면 메인이 새 포트를 다시 보내므로
 * 이 핸들러는 **여러 번 불린다**.
 */
ipcRenderer.on(BACKEND_PORT_CHANNEL, (event: IpcRendererEvent) => {
  const port = event.ports[0];
  if (!port) return;
  window.postMessage({ type: RENDERER_PORT_MESSAGE }, '*', [port]);
});

export {};
