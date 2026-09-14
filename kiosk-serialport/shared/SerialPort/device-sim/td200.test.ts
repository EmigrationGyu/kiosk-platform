import { describe, expect, it } from 'bun:test';
import { Td200Simulator } from './td200';

/** `STX | CMD | ETX | BCC` 최소 프레임. BCC 는 시뮬레이터가 검사하지 않는다. */
const cmd = (mnemonic: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x02]),
    Buffer.from(mnemonic, 'ascii'),
    Buffer.from([0x03, 0x00]),
  ]);

/** ENQ — 명령에 ACK 만 오므로 본문은 이걸로 가지러 간다(2단 규약). */
const ENQ = Buffer.from([0x05, 0x30, 0x30]);

/** 데이터 프레임에서 상태 4바이트를 니블로 되돌린다(꼬리 = ETX+BCC 2바이트). */
const statusOf = (res: Buffer): number => {
  const tail = res.subarray(res.length - 6, res.length - 2);
  return [...tail].reduce((acc, b) => (acc << 4) | (b - 0x30), 0);
};

/** 명령 1회 + 본문 수령. 실제 서비스가 하는 왕복 그대로. */
const roundTrip = (sim: Td200Simulator, mnemonic: string): Buffer => {
  sim.handle(cmd(mnemonic));
  return sim.handle(ENQ);
};

const FLAG = {
  DISPENSING: 0x0800,
  TOKEN_OVERLAP: 0x0040,
  TOKEN_EMPTY: 0x0010,
  AT_MID: 0x0002,
  AT_GATE: 0x0001,
} as const;

const on = (res: Buffer, flag: number) => (statusOf(res) & flag) !== 0;

describe('Td200Simulator — 프레이밍', () => {
  it('명령에는 ACK 만, 본문은 ENQ 에 답한다 — 2단 규약', () => {
    const sim = new Td200Simulator();
    const ack = sim.handle(cmd('S4'));
    expect(ack).toEqual(Buffer.from([0x06, 0x30, 0x30]));

    const body = sim.handle(ENQ);
    expect(body[0]).toBe(0x02); // STX
    expect(body.subarray(5, 7).toString('ascii')).toBe('SR');
    expect(body[body.length - 2]).toBe(0x03); // ETX
  });

  it('상태 바이트는 항상 출력 가능한 ASCII 범위에 머문다', () => {
    const sim = new Td200Simulator({ hopper: 0 });
    sim.handle(cmd('S4'));
    const tail = sim.handle(ENQ).subarray(7, 11);
    for (const b of tail) {
      expect(b).toBeGreaterThanOrEqual(0x30);
      expect(b).toBeLessThanOrEqual(0x3f);
    }
  });

  it('알 수 없는 명령은 NAK', () => {
    expect(new Td200Simulator().handle(cmd('QQ'))[0]).toBe(0x15);
  });
});

describe('Td200Simulator — 모터는 폴 횟수로 흐른다', () => {
  // 즉시 완료로 만들면 FSM 의 "진행 중" 전이가 한 번도 안 밟힌다.
  it('방출은 중간 상태를 거쳐 게이트에 도달한다', () => {
    const sim = new Td200Simulator({ hopper: 5, motorPolls: 2 });
    expect(on(roundTrip(sim, 'T1'), FLAG.DISPENSING)).toBe(true);

    const poll1 = roundTrip(sim, 'S4');
    expect(on(poll1, FLAG.AT_MID)).toBe(true);
    expect(on(poll1, FLAG.AT_GATE)).toBe(false);

    const poll2 = roundTrip(sim, 'S4');
    expect(on(poll2, FLAG.AT_GATE)).toBe(true);
    expect(on(poll2, FLAG.DISPENSING)).toBe(false);
  });

  it('가져가기 전에 또 밀면 겹쳐 물린다', () => {
    const sim = new Td200Simulator({ hopper: 5, motorPolls: 1 });
    roundTrip(sim, 'T1');
    roundTrip(sim, 'S4');
    expect(on(roundTrip(sim, 'T1'), FLAG.TOKEN_OVERLAP)).toBe(true);
  });

  it('가져가면 다음 장이 나간다', () => {
    const sim = new Td200Simulator({ hopper: 5, motorPolls: 1 });
    roundTrip(sim, 'T1');
    roundTrip(sim, 'S4');
    expect(sim.takeToken()).toBe(true);
    expect(on(roundTrip(sim, 'T1'), FLAG.TOKEN_OVERLAP)).toBe(false);
  });
});

describe('Td200Simulator — 호퍼', () => {
  it('소진되면 방출이 거절된다', () => {
    const sim = new Td200Simulator({ hopper: 1, motorPolls: 1 });
    roundTrip(sim, 'T1');
    roundTrip(sim, 'S4');
    sim.takeToken();
    expect(on(roundTrip(sim, 'T1'), FLAG.TOKEN_EMPTY)).toBe(true);
    expect(sim.remaining).toBe(0);
  });

  it('회수하면 호퍼로 돌아온다 — 총량이 보존된다', () => {
    const sim = new Td200Simulator({ hopper: 3, motorPolls: 1 });
    roundTrip(sim, 'T1');
    roundTrip(sim, 'S4');
    expect(sim.remaining).toBe(2);
    roundTrip(sim, 'T3');
    roundTrip(sim, 'S4');
    expect(sim.remaining).toBe(3);
  });
});
