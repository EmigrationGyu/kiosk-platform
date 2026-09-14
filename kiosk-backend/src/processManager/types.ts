import type { SerialportProcess } from 'kiosk-types';
import type { RequestEnding } from './activity';

/**
 * 서브프로세스 한 개의 **수명** 핸들. 메시지 채널은 여기 없다 — 환경마다 다르기 때문이다(electron 은
 * utilityProcess 의 postMessage, node 는 express-ipc 파이프). 수명과 채널을 한 타입에 담으면 한쪽
 * 환경에서 반드시 죽은 메서드가 생긴다. `channel` 은 그 환경의 채널을 그대로 통과시키는 자리이고,
 * processManager 는 들여다보지 않는다.
 */
export type ProcessHandle<C = unknown> = {
  channel: C;
  /**
   * 자식이 요청을 받을 수 있게 된 시점. 환경마다 의미가 다르다 — electron 은 IPC 가
   * 버퍼링되므로 즉시 resolve 되고, node 는 자식이 파이프 서버를 연 뒤여야 하므로
   * `[ready]` 를 보고 resolve 한다. bridge 는 fork 자체가 실패하면(자산 미확보 등)
   * reject 한다 — 그 핸들은 exit 으로 접혀 매니저에서 빠지므로 다음 요청이 다시 띄운다.
   */
  ready: Promise<void>;
  onExit(listener: (code: number | null) => void): void;
  onStdout(listener: (text: string) => void): void;
  onStderr(listener: (text: string) => void): void;
  kill(): void;
};

/**
 * 프로세스 식별자를 실행 중인 자식으로 바꾸는 **메커니즘**. 실행 파일 경로·명령·부트스트랩 방식은
 * 전부 여기 안에 있다 — 언제 띄우고 거둘지는 processManager 가 정하고, 어떻게 띄우는지는 이쪽만 안다.
 */
export type Spawner<C = unknown> = {
  spawn(process: SerialportProcess): ProcessHandle<C>;
};

export type ProcessManager<C = unknown> = {
  /** 살아있는 자식을 돌려주고, 없으면 그 자리에서 띄운다. spawn 실패 시 throw. */
  ensure(process: SerialportProcess): ProcessHandle<C>;
  /** lazy 가 아닌 서브프로세스를 미리 띄운다. */
  startEager(): void;
  /**
   * 자식이 **(재)기동될 때마다** 불린다. 자식이 죽고 다시 떠도 부모가 쥔 상태(예: outbox 의 원격
   * 자격증명)는 자동으로 따라가지 않는다 — 다시 밀어줘야 하는 쪽이 여기 등록한다. 구독으로 둔 이유는
   * 방향이다: 이 모듈이 소비자를 import 하면 트랜스포트를 거쳐 순환한다.
   */
  onSpawned(listener: (process: SerialportProcess) => void): void;
  /** idle 회수 1회분. 종료시킨 프로세스 목록을 반환한다(테스트는 이걸 직접 부른다). */
  reapIdle(now: number): SerialportProcess[];
  /** reapIdle 을 주기 실행. 중복 호출은 무시된다. */
  startReaper(): void;
  /** 앱 종료 — 전부 내리고, 이후 exit 를 크래시로 오인하지 않는다. */
  stopAll(): void;
  /** 요청 송신 직전/응답 종료 시점. idle 판정의 근거가 된다. */
  markRequestStart(process: SerialportProcess): void;
  markRequestEnd(process: SerialportProcess, ending: RequestEnding): void;
  /** 말을 걸어본 프로세스가 전부 봉투를 돌려줬는가 — 승격 조건의 절반. */
  allAnswered(): boolean;
  /**
   * 장치 명령이 모두 끝나기를 기다린다 — 업데이트 적용 시점을 고르는 신호.
   * 끊긴 명령은 실패가 아니라 결과 불명이라, 처리하는 대신 일어나지 않게 한다.
   */
  awaitQuiescence(): Promise<void>;
};
