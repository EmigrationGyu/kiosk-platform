import { describe, expect, it } from 'bun:test';
import { parseStatus } from './parseStatus';

/** "SR" 이후 4바이트 상태 버퍼. 스펙 표기(0x38 0x30 0x30 0x30)를 그대로 옮긴다. */
const bytes = (ascii: string) => Buffer.from(ascii, 'ascii');

/** 켜져 있는 플래그 이름만 뽑아 비교를 읽기 쉽게 만든다. */
const raised = (buf: Buffer): string[] =>
  Object.entries(parseStatus(buf))
    .filter(([, on]) => on)
    .map(([flag]) => flag)
    .sort();

describe('parseStatus — 단일 플래그 (PROTOCOL.md 상태 표)', () => {
  it.each([
    ['8000', 'returnBoxFull'],
    ['4000', 'commandNotExecutable'],
    ['2000', 'hopperFull'],
    ['1000', 'hopperPreFull'],
    ['0800', 'dispensing'],
    ['0400', 'collecting'],
    ['0200', 'dispenseError'],
    ['0100', 'returnError'],
    ['0080', 'tokenJam'],
    ['0040', 'tokenOverlap'],
    ['0020', 'tokenPreEmpty'],
    ['0010', 'tokenEmpty'],
    ['0004', 'tokenAtHopper'],
    ['0002', 'tokenAtMid'],
    ['0001', 'tokenAtGate'],
  ])('%s → %s 하나만', (ascii, flag) => {
    expect(raised(bytes(ascii))).toEqual([flag]);
  });

  it('0000 → 모든 플래그 false', () => {
    expect(raised(bytes('0000'))).toEqual([]);
  });
});

describe('parseStatus — 니블 오버플로우 (0x3a~0x3f)', () => {
  // 실장애 박제: 반환함이 가득 찬 상태에서 회수 명령 → 장비가 '<000' 응답.
  // 니블 0xc = returnBoxFull(0x8) | commandNotExecutable(0x4).
  // 구현이 parseInt(ascii, 16) 이던 시절 NaN → throw → 전 명령 락아웃(RESET 포함)으로 번졌다.
  it("'<000' → returnBoxFull + commandNotExecutable", () => {
    expect(raised(bytes('<000'))).toEqual([
      'commandNotExecutable',
      'returnBoxFull',
    ]);
  });

  it("'<003' → 위 + 토큰이 중간·게이트 센서에 걸쳐 있음", () => {
    expect(raised(bytes('<003'))).toEqual([
      'commandNotExecutable',
      'returnBoxFull',
      'tokenAtGate',
      'tokenAtMid',
    ]);
  });

  it("':' (0xa) — st1 이 넘쳐도 무손실 (dispensing|dispenseError)", () => {
    expect(raised(bytes('0:00'))).toEqual(['dispenseError', 'dispensing']);
  });

  it("'?' (0xf) — 한 니블의 네 비트 전부 (0x8 은 미할당이라 3개)", () => {
    expect(raised(bytes('000?'))).toEqual([
      'tokenAtGate',
      'tokenAtHopper',
      'tokenAtMid',
    ]);
  });

  it('전 비트 셋 — 정의된 15개 플래그가 모두 선다(0x0008 은 미할당)', () => {
    expect(raised(bytes('????'))).toHaveLength(15);
  });
});

describe('parseStatus — 조용한 오염 방지', () => {
  // parseInt("8<00", 16) 은 '<' 에서 멈추고 8 을 돌려준다 → returnBoxFull:false,
  // tokenEmpty:true 라는 그럴듯한 거짓말. throw 도 없어 더 위험했다.
  it("'8<00' 은 상위 니블에서 잘리지 않고 온전히 해석된다", () => {
    expect(raised(bytes('8<00'))).toEqual([
      'collecting',
      'dispensing',
      'returnBoxFull',
    ]);
  });

  it("'80<0' 도 마찬가지", () => {
    expect(raised(bytes('80<0'))).toEqual([
      'returnBoxFull',
      'tokenJam',
      'tokenOverlap',
    ]);
  });
});

describe('parseStatus — 범위 밖 바이트는 거부', () => {
  it.each([
    ['@000', '0x40 — 0x3f 초과'],
    ['/000', '0x2f — 0x30 미만'],
    ['00C0', "ASCII hex 'C'(0x43) 는 이 프로토콜의 인코딩이 아니다"],
    ['000\x00', 'NUL'],
  ])('%s 거부 (%s)', (ascii) => {
    expect(() => parseStatus(bytes(ascii))).toThrow(/Invalid status bytes/);
  });

  it('길이가 4가 아니면 거부', () => {
    expect(() => parseStatus(bytes('000'))).toThrow(/Expected 4 status bytes/);
    expect(() => parseStatus(bytes('00000'))).toThrow(
      /Expected 4 status bytes/,
    );
  });
});
