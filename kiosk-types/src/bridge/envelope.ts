/**
 * MessagePort 위를 흐르는 봉투 — 백엔드가 electron 메인 밖에서 돌 때의 통신 계약.
 *
 * `ipcMain.handle` 은 채널명이 라우팅을 대신했지만 MessagePort 는 채널이 하나뿐이라 그 역할을
 * 봉투가 들고 다닌다. 대신 **안쪽 봉투는 손대지 않는다** — 요청 body 와 응답을 그대로 실어
 * 검증·파싱 로직이 전송 수단 교체에 영향받지 않게 한다.
 */

/** 라우팅 주소. 프론트↔백엔드는 `${namespace}${event}`, 백엔드↔serialport 는 event. */
export type PortAddress = string;

export type PortRequest = {
  kind: 'request';
  address: PortAddress;
  id: string;
  body: unknown;
};

export type PortResponse = {
  kind: 'response';
  id: string;
  /** 기존 와이어 응답 봉투를 그대로 싣는다. */
  payload: unknown;
};

/**
 * 백엔드 → 메인 능력 호출. electron 에서만 가능한 것(safeStorage·프로세스 fork)을
 * 자식 프로세스가 빌려 쓰는 통로다. **닫힌 집합으로 유지한다** — 여기가 자라면
 * 백엔드가 electron 에 다시 묶이고 있다는 신호다.
 */
export const BRIDGE_METHOD = {
  SECURE_SET: 'secureStorage.set',
  SECURE_GET: 'secureStorage.get',
  SECURE_DELETE: 'secureStorage.delete',
  PROCESS_SPAWN: 'process.spawn',
  PROCESS_KILL: 'process.kill',
  /**
   * "나는 렌더러 포트를 받을 준비가 됐다" — 구독이지 일회성 조회가 아니다. 포트는 **양쪽이
   * 준비된 뒤에** 따로 온다: 구독 시점에 렌더러가 아직 없을 수 있고 리로드마다 새 포트가 와야
   * 한다. 부모가 준비 시점을 추측해 밀어넣는 대신 자식이 선언하게 해 배선이 타이밍이 아니라
   * **사실**로 결정되게 한다.
   */
  RENDERER_PORT_SUBSCRIBE: 'renderer.subscribePort',
  /**
   * "렌더러가 살아서 그리기 시작했다" — 백엔드가 받은 생존 선언의 전달. 부모가 이걸 아는 이유는
   * 하나, 렌더러 준비 워치독의 해제다: 흰 화면(JS 크래시)은 프로세스 이벤트를 하나도 내지 않아
   * 선언의 부재만이 유일한 증거다.
   *
   * **부팅 완주(승격 근거)가 아니다** — 완주는 터치·네트워크가 껴 있어 무인 부팅에선 영영 오지
   * 않을 수 있고, 워치독 근거로 쓰면 멀쩡한 프론트를 되감는다(실측). 렌더러가 메인에 직접 알리지
   * 않고 백엔드를 경유하는 것은 같은 사실의 출처가 둘이면 어긋나기 때문이다.
   */
  RENDERER_ALIVE: 'renderer.alive',
  /**
   * "이 매니페스트를 적용해줘" — 백엔드가 **조용해진 것을 확인한 뒤** 부른다.
   *
   * 시점 판단이 백엔드에 있는 이유: 장치 in-flight 는 백엔드만 아는 사실이고, 교체 중에 끊긴
   * 명령은 실패가 아니라 **결과 불명**이 된다(현금 방출 같은 건 되돌릴 수 없다). 실행이 부모에
   * 있는 이유: 교체당하는 프로세스가 자기 교체를 검증하고 되감을 수는 없다.
   */
  UPDATE_APPLY: 'update.apply',
  /**
   * "지금 조합이 실제로 도는 것을 확인했다" — 되감기 목적지로 승격해달라. 적용과 분리된 이유:
   * 적용 시점에 알 수 있는 최선은 "떴다"뿐이고 진짜 증거는 그 뒤에 쌓인다.
   */
  UPDATE_MARK_STABLE: 'update.markStable',
  /**
   * "지금 조합의 계약이 어긋났다" — 마지막 안정 조합으로 되감아달라. 계약 대조는 실행 중인
   * 것들이 서로 지문을 알려와야 가능하므로 적용 **후**에 드러난다. 그래서 거부가 아니라 되감기다.
   */
  UPDATE_ROLLBACK: 'update.rollback',
  /**
   * "이 지시는 이렇게 끝났다" — 기록에 남겨달라. 기록을 쓰는 것은 부모뿐이지만(교체당하는 쪽은
   * 자기 결과를 보고할 수 없다) **부모에 닿기 전에 끝나는 결과**가 있다: 산출물 받기 실패
   * (404·해시·서명·네트워크)와 이미 그 버전이라 설치하지 않는 경우. 이 창구가 없으면 그 둘은
   * 로그에만 남고 서버로 나가는 표면에서 사라진다.
   */
  UPDATE_RECORD: 'update.record',
  /**
   * "이 기록은 서버에 갔다" — `reported` 를 세워달라. 기록의 주인은 부모 하나라 백엔드가 직접
   * 쓰지 않는다. 부모가 없는 토폴로지에선 세울 기록도 없으므로 알리기만 하는 것으로 분류한다.
   */
  UPDATE_REPORTED: 'update.reported',
} as const;

export type BridgeMethod = (typeof BRIDGE_METHOD)[keyof typeof BRIDGE_METHOD];

export type BridgeCall = {
  kind: 'call';
  id: string;
  method: BridgeMethod;
  args: readonly unknown[];
};

/**
 * `PROCESS_SPAWN` 의 인자 — 브리지를 건너므로 **양쪽이 같은 모양을 봐야 한다.** `args` 가
 * 의도적으로 `unknown[]` 이라 메서드별 모양이 계약에 없는데 이건 예외다: 한쪽만 필드를 알면
 * 조용히 옛 방식으로 뜨고, 그 자식은 자기 네이티브 의존을 못 연다.
 *
 * `execPath` 없음 = 호스트 런타임(utilityProcess). 있으면 그 실행파일 — **부모는 왜인지 모른다.**
 * 아키텍처 판정도 경로 해소도 백엔드 몫이라, 앞으로 만질 것이 전부 부분 업데이트를 타는 쪽에 남는다.
 */
export type ProcessSpawnArgs = {
  process: string;
  entry: string;
  execPath?: string;
};

export type BridgeResult =
  | { kind: 'result'; id: string; ok: true; value: unknown }
  | { kind: 'result'; id: string; ok: false; error: string };

/**
 * 메인이 자식에게 포트를 넘길 때의 알림. 포트 자체는 `postMessage` 의 transfer 로 오고, 이
 * 메시지는 **그게 무슨 용도인지**만 말한다. 자식 프로세스용 포트는 spawn 결과 메시지에 실려
 * 오므로 알림이 필요 없고, 여기 필요한 건 렌더러용 포트다(재기동 시 같은 tag 로 다시 온다).
 */
export type PortHandoff = {
  kind: 'port';
  tag: 'renderer';
};

/**
 * 부모가 자식 프로세스의 생명주기를 알려주는 단방향 통지. 자식 포트는 하드웨어 요청/응답
 * 전용으로 두고 생명주기는 이 채널로 보낸다 — 섞으면 transport 가 자기와 무관한 메시지를
 * 걸러내야 한다.
 */
export type BridgeEvent = {
  kind: 'event';
  /** SerialportProcess 식별자. */
  process: string;
  event: 'exit' | 'stdout' | 'stderr';
  code?: number | null;
  text?: string;
};

export type PortMessage =
  | PortRequest
  | PortResponse
  | BridgeCall
  | BridgeResult
  | BridgeEvent
  | PortHandoff;

export const isPortRequest = (m: PortMessage): m is PortRequest =>
  m.kind === 'request';
export const isPortResponse = (m: PortMessage): m is PortResponse =>
  m.kind === 'response';
export const isBridgeCall = (m: PortMessage): m is BridgeCall =>
  m.kind === 'call';
export const isBridgeResult = (m: PortMessage): m is BridgeResult =>
  m.kind === 'result';
export const isPortHandoff = (m: PortMessage): m is PortHandoff =>
  m.kind === 'port';
export const isBridgeEvent = (m: PortMessage): m is BridgeEvent =>
  m.kind === 'event';

/**
 * preload 가 받은 포트를 페이지 월드로 넘길 때 쓰는 window 메시지 타입. `contextBridge` 는
 * MessagePort 를 그대로 노출할 수 없어(전송 가능 객체라 복제 대상이 아님) transfer 로 건넨다.
 * preload 와 렌더러가 서로 다른 레포라 여기서 공유한다 — 문자열이 갈리면 화면이 조용히 먹통이 된다.
 */
export const RENDERER_PORT_MESSAGE = 'kiosk:backend-port';

/**
 * 렌더러 포트가 **갈렸을 때** 페이지에 알리는 DOM 이벤트 이름.
 *
 * 백엔드가 교체되면 렌더러는 그대로 살아있어 부팅을 다시 타지 않는다 — 그러면 새 백엔드는
 * 렌더러가 이미 떴다는 사실도 계약 지문도 모른 채 남고, 계약이 어긋나도 다음 부팅까지
 * 드러나지 않는다(실측). 웹 표준 DOM 이벤트라 다른 트랜스포트 구현도 같은 이름을 쓴다.
 */
export const PORT_REPLACED_EVENT = 'kiosk:port-replaced';

/**
 * 렌더러가 "수신 준비 끝"을 알리는 window 메시지 타입. 포트 리스너를 건 **직후** 렌더러가
 * 스스로 보낸다 — `did-finish-load` 는 "페이지가 로드됐다"이지 "트랜스포트가 리스너를 걸었다"가
 * 아니라서, 그 차이가 실제로 사고를 냈다.
 *
 * 웹 표준 `window.postMessage` 를 쓴다 — 렌더러는 자기가 어떤 껍데기 위에서 도는지 몰라야 한다.
 */
export const RENDERER_READY_MESSAGE = 'kiosk:renderer-ready';

/**
 * 자식 프로세스에 주입되는 환경 값의 키 — `Platform` 이 읽는다. RPC 가 아니라 env 인 이유:
 * 부팅 시 확정되어 변하지 않고, `Platform` 이 동기 상수 객체라 왕복을 기다릴 수 없다.
 */
export const BRIDGE_ENV = {
  USER_DATA: 'KIOSK_USER_DATA',
  BASELINE: 'KIOSK_BASELINE',
  APP_VERSION: 'KIOSK_APP_VERSION',
  IS_PACKAGED: 'KIOSK_IS_PACKAGED',
} as const;
