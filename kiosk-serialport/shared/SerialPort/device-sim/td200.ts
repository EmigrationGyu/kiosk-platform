/**
 * TD-200 토큰 디스펜서 시뮬레이터 — 프로토콜만 아는 순수 상태기.
 *
 * 하드웨어 없이 전 스택을 돌리기 위한 것이지, 장비를 정확히 흉내내려는 것이 아니다.
 * 그래서 **모터 지연을 폴 횟수로 흉내낸다** — 실물이 수백 ms 걸리는 구간을 FSM 이
 * "진행 중"으로 관측해야 전이 로직이 실제로 돌아가기 때문이다. 즉시 완료로 만들면
 * `needsPrev` 전이도 모터 정지 확인도 한 번도 안 밟힌다.
 *
 * 프로토콜 전문: `packages/token-dispenser/PROTOCOL.md`
 */

const STX = 0x02;
const ETX = 0x03;
const EOT = 0x04;
const ENQ = 0x05;
const ACK = 0x06;
const NAK = 0x15;

/** 니블 4개를 각각 `0x30 + nibble` 로. PROTOCOL.md "상태 바이트" 참고. */
const encodeStatus = (bits: number): Buffer =>
  Buffer.from([
    0x30 + ((bits >> 12) & 0xf),
    0x30 + ((bits >> 8) & 0xf),
    0x30 + ((bits >> 4) & 0xf),
    0x30 + (bits & 0xf),
  ]);

const FLAG = {
  RETURN_BOX_FULL: 0x8000,
  COMMAND_NOT_EXECUTABLE: 0x4000,
  HOPPER_FULL: 0x2000,
  HOPPER_PRE_FULL: 0x1000,
  DISPENSING: 0x0800,
  COLLECTING: 0x0400,
  DISPENSE_ERROR: 0x0200,
  RETURN_ERROR: 0x0100,
  TOKEN_JAM: 0x0080,
  TOKEN_OVERLAP: 0x0040,
  TOKEN_PRE_EMPTY: 0x0020,
  TOKEN_EMPTY: 0x0010,
  TOKEN_AT_HOPPER: 0x0004,
  TOKEN_AT_MID: 0x0002,
  TOKEN_AT_GATE: 0x0001,
} as const;

export type Td200Options = {
  /** 호퍼 초기 적재량. 0 이면 곧바로 소진 상태로 시작한다. */
  hopper?: number;
  /** 모터 동작이 걸리는 폴 횟수. 0 이면 즉시 완료 — 전이 로직이 안 밟힌다. */
  motorPolls?: number;
  /** 반환함 용량. */
  returnBoxCapacity?: number;
};

type Motion = { kind: 'dispense' | 'return' | 'collect'; left: number };

/**
 * 명령 프레임을 받아 응답 프레임을 돌려준다. 내부 상태는 호퍼·게이트·반환함뿐이고
 * 시간은 **폴 횟수로만** 흐른다(실시간 타이머 없음 — 테스트가 결정론적이어야 한다).
 */
export class Td200Simulator {
  private hopper: number;
  private readonly motorPolls: number;
  private readonly returnBoxCapacity: number;
  private returnBox = 0;
  private atGate = false;
  private atMid = false;
  private motion: Motion | null = null;
  /** 직전 명령이 세운 부가 플래그 — 다음 ENQ 응답에 실린다. */
  private pending = 0;

  constructor(opts: Td200Options = {}) {
    this.hopper = opts.hopper ?? 20;
    this.motorPolls = opts.motorPolls ?? 2;
    this.returnBoxCapacity = opts.returnBoxCapacity ?? 50;
  }

  /** 게이트의 토큰을 사람이 가져갔다고 알린다 — 데모 UI 의 "가져가기" 버튼. */
  takeToken(): boolean {
    if (!this.atGate) return false;
    this.atGate = false;
    return true;
  }

  get remaining(): number {
    return this.hopper;
  }

  private statusBits(): number {
    let bits = 0;
    if (this.motion?.kind === 'dispense') bits |= FLAG.DISPENSING;
    if (this.motion && this.motion.kind !== 'dispense') bits |= FLAG.COLLECTING;
    if (this.atGate) bits |= FLAG.TOKEN_AT_GATE;
    if (this.atMid) bits |= FLAG.TOKEN_AT_MID;
    if (this.hopper === 0) bits |= FLAG.TOKEN_EMPTY;
    else if (this.hopper <= 3) bits |= FLAG.TOKEN_PRE_EMPTY;
    if (this.returnBox >= this.returnBoxCapacity) bits |= FLAG.RETURN_BOX_FULL;
    return bits;
  }

  /** 폴 1회 = 모터가 한 칸 움직인다. 상태 조회가 곧 시간의 흐름이다. */
  private advance(): void {
    if (!this.motion) return;
    this.motion.left -= 1;
    if (this.motion.left > 0) {
      this.atMid = true;
      return;
    }
    this.atMid = false;
    if (this.motion.kind === 'dispense') this.atGate = true;
    else if (this.motion.kind === 'return') this.returnBox += 1;
    else this.hopper += 1;
    this.motion = null;
  }

  private begin(kind: Motion['kind']): number {
    if (this.motion) return FLAG.COMMAND_NOT_EXECUTABLE;
    if (kind === 'dispense') {
      if (this.hopper === 0) return FLAG.TOKEN_EMPTY;
      // 게이트에 남은 토큰 위로 또 밀면 겹쳐 물린다 — 실물이 tokenOverlap 을 세우는 자리.
      if (this.atGate) return FLAG.TOKEN_OVERLAP;
      this.hopper -= 1;
    } else {
      if (!this.atGate) return FLAG.COMMAND_NOT_EXECUTABLE;
      this.atGate = false;
    }
    this.motion = { kind, left: this.motorPolls };
    return 0;
  }

  /**
   * 프레임 1개 처리. 반환값이 곧 전선에 흐를 바이트다.
   *
   * **2단 규약**: 명령에는 ACK 만 답하고, 상태 본문은 뒤따르는 ENQ 에 답한다. 한 프레임에
   * 몰아 보내면 파서가 ACK 만 떼고 나머지를 버려, 이어지는 ENQ 왕복이 타임아웃으로 죽는다.
   */
  handle(frame: Buffer): Buffer {
    if (frame.includes(ENQ)) {
      const pending = this.pending;
      this.pending = 0;
      return dataFrame(
        Buffer.concat([
          Buffer.from('SR', 'ascii'),
          encodeStatus(this.statusBits() | pending),
        ]),
      );
    }
    if (frame.includes(EOT)) {
      this.pending = 0;
      return Buffer.from([ACK, 0x30, 0x30]);
    }

    const cmd = parseCommand(frame);
    if (!cmd) return Buffer.from([NAK]);

    let extra = 0;
    switch (cmd) {
      case 'S4':
      case 'S3':
        this.advance();
        break;
      case 'T1':
        extra = this.begin('dispense');
        break;
      case 'P4':
      case 'P6':
        extra = this.begin('dispense');
        break;
      case 'T2':
        extra = this.begin('return');
        break;
      case 'T3':
        extra = this.begin('collect');
        break;
      case 'Z0':
        this.motion = null;
        this.atMid = false;
        break;
      case 'F0':
      case 'F1':
      case 'B0':
      case 'B1':
        break;
      default:
        return Buffer.from([NAK]);
    }

    // 본문은 ENQ 가 가지러 온다 — 그때까지 이번 명령의 부가 플래그를 들고 있는다.
    this.pending = extra;
    return Buffer.from([ACK, 0x30, 0x30]);
  }
}

/** `STX | CMD | ... | ETX | BCC` 에서 명령 니모닉만 꺼낸다. */
function parseCommand(frame: Buffer): string | null {
  const stx = frame.indexOf(STX);
  const etx = frame.indexOf(ETX, stx + 1);
  if (stx < 0 || etx < 0) return null;
  const body = frame.subarray(stx + 1, etx).toString('ascii');
  const m = body.match(/[A-Z][0-9A-Z]/);
  return m ? m[0] : null;
}

/**
 * `STX + ADDR(2) + LEN(2) + DATA + ETX + BCC` — 송신 빌더(`buildCommandPacket`)와 **같은 규격**.
 * 파서가 길이와 체크섬을 교차 검증하므로 어느 한쪽만 틀려도 프레임이 통째로 버려진다.
 */
function dataFrame(data: Buffer): Buffer {
  const withoutBcc = Buffer.from([
    STX,
    0x30,
    0x30,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
    ...data,
    ETX,
  ]);
  const bcc = withoutBcc.reduce((acc, b) => acc ^ b, 0);
  return Buffer.concat([withoutBcc, Buffer.from([bcc])]);
}
