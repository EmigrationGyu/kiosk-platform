import type { SerialportProcess } from 'kiosk-types';

/**
 * 요청이 어떻게 끝났는가.
 *
 * **봉투가 돌아왔는지**만 본다 — 내용이 성공인지는 보지 않는다. `연결 실패` 라는 응답도
 * 서브프로세스가 살아서 자기 코드를 돌렸다는 증거다. 하드웨어 고장은 업데이트 전후로 같은
 * 사실이라 소프트웨어 판정에 섞으면 안 된다.
 */
export type RequestEnding = 'answered' | 'unanswered';

/** 현재 응답 대기 중인 요청 수와 마지막 활동 시각. in-flight 0 이어야 idle 후보다. */
export type ProcessActivity = {
  inFlight: number;
  lastActiveAt: number;
  /** 이 프로세스가 한 번이라도 봉투를 돌려줬는가. */
  answered: boolean;
  /** 물어봤는데 답이 없었던 적이 있는가. */
  unanswered: boolean;
};

export type ActivityLog = {
  markStart(process: SerialportProcess): void;
  markEnd(process: SerialportProcess, ending: RequestEnding): void;
  clear(process: SerialportProcess): void;
  /** in-flight 0 이고 idleMs 이상 무활동인 프로세스 목록. */
  idleSince(now: number, idleMs: number): SerialportProcess[];
  /** 살아있는 프로세스 없이 남은 레코드 정리용. */
  tracked(): SerialportProcess[];
  /**
   * 어느 장치에도 응답 대기 중인 요청이 없는가.
   *
   * 업데이트는 여기가 참일 때만 적용한다 — 교체 중에 끊긴 명령은 "실패"가 아니라
   * **결과 불명**이 되고(장치까지 갔는지 알 수 없다), 현금 방출 같은 건 되돌릴 수 없다.
   */
  isQuiescent(): boolean;
  /**
   * 말을 걸어본 프로세스가 **전부** 봉투를 돌려줬는가 — 승격 조건의 절반.
   *
   * 한 번도 안 물어본 프로세스는 무관하다(이 키오스크의 워킹셋이 아니라는 뜻). 답이 없었던
   * 적이 있으면 소프트웨어 문제로 본다.
   */
  allAnswered(): boolean;
};

/**
 * 서브프로세스별 활동 기록. `now` 를 주입받아 reaper 판정을 시간에 묶이지 않게 테스트한다.
 *
 * in-flight 계수가 핵심이다 — 장시간 대기 요청(카드결제 10분 timeout)이 걸려 있는
 * 프로세스를 reaper 가 idle 로 오인해 내리면 그 거래가 죽는다. markStart/markEnd 는
 * 반드시 1:1 이어야 하며, transport 는 응답·타임아웃 **모든 종료 경로**에서 markEnd 한다.
 */
export function createActivityLog(now: () => number = Date.now): ActivityLog {
  const registry = new Map<SerialportProcess, ProcessActivity>();

  return {
    markStart(process) {
      const cur = registry.get(process) ?? {
        inFlight: 0,
        lastActiveAt: now(),
        answered: false,
        unanswered: false,
      };
      cur.inFlight += 1;
      cur.lastActiveAt = now();
      registry.set(process, cur);
    },
    markEnd(process, ending) {
      const cur = registry.get(process);
      if (!cur) return;
      cur.inFlight = Math.max(0, cur.inFlight - 1);
      cur.lastActiveAt = now();
      if (ending === 'answered') cur.answered = true;
      else cur.unanswered = true;
    },
    clear(process) {
      registry.delete(process);
    },
    idleSince(at, idleMs) {
      const idle: SerialportProcess[] = [];
      for (const [process, a] of registry) {
        if (a.inFlight === 0 && at - a.lastActiveAt > idleMs)
          idle.push(process);
      }
      return idle;
    },
    tracked() {
      return [...registry.keys()];
    },
    allAnswered() {
      for (const a of registry.values()) {
        if (a.unanswered || !a.answered) return false;
      }
      return true;
    },
    isQuiescent() {
      for (const a of registry.values()) {
        if (a.inFlight > 0) return false;
      }
      return true;
    },
  };
}
