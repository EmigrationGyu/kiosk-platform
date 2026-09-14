import { describe, expect, it } from 'bun:test';
import { evaluateTransition } from '@/shared/FSM/evaluateTransition';
import type { TransitionResult } from '@/shared/FSM/types';
import type { DispenserStatus } from '../utils/parseStatus';
import {
  dispenseToMidTransition,
  dispenseTransition,
  isCommandBlocked,
} from './transitions';

/** 전부 false 인 기준 상태 — 필요한 플래그만 덮어써서 케이스를 읽기 쉽게 만든다. */
const status = (over: Partial<DispenserStatus> = {}): DispenserStatus => ({
  returnBoxFull: false,
  commandNotExecutable: false,
  hopperPreFull: false,
  dispensing: false,
  collecting: false,
  dispenseError: false,
  returnError: false,
  hopperFull: false,
  tokenOverlap: false,
  tokenJam: false,
  tokenPreEmpty: false,
  tokenEmpty: false,
  tokenAtGate: false,
  tokenAtMid: false,
  tokenAtHopper: false,
  ...over,
});

const t = dispenseTransition;

/** 첫 폴(직전 상태 없음) 판정. */
const first = (over: Partial<DispenserStatus>): TransitionResult =>
  evaluateTransition(status(over), t, null);

/**
 * 상태 시퀀스를 순서대로 먹여(각 폴의 prev = 직전 폴) 마지막 판정을 돌려준다.
 * StateMachine.feed 가 매 틱 직전 _lastStatus 를 evaluateTransition 에 넘기는 것을 모사.
 */
const feedAll = (seq: Partial<DispenserStatus>[]): TransitionResult => {
  let prev: DispenserStatus | null = null;
  let result: TransitionResult = 'IN_PROGRESS';
  for (const over of seq) {
    const s = status(over);
    result = evaluateTransition(s, t, prev);
    prev = s;
  }
  return result;
};

describe('dispenseTransition — 홀딩/오버배출 배출 완료', () => {
  it('발급 시작 전 과도상태(all-false·직전 없음)는 IN_PROGRESS — 즉시 COMPLETE 금지', () => {
    expect(first({})).toBe('IN_PROGRESS');
  });

  it('직전에도 이송로가 비었으면 all-false 가 이어져도 계속 IN_PROGRESS', () => {
    expect(feedAll([{}, {}, {}])).toBe('IN_PROGRESS');
  });

  it('모터 동작 중(dispensing)은 IN_PROGRESS', () => {
    expect(first({ dispensing: true })).toBe('IN_PROGRESS');
  });

  it('정상 대기: 모터 정지 + 게이트 도달 → COMPLETE (prev 무관)', () => {
    expect(first({ tokenAtGate: true })).toBe('COMPLETE');
  });

  it('이송 중(호퍼·중간 센서 물림)은 IN_PROGRESS', () => {
    expect(first({ tokenAtMid: true })).toBe('IN_PROGRESS');
    expect(first({ tokenAtHopper: true })).toBe('IN_PROGRESS');
  });

  // 회귀 박제: 손님이 게이트의 토큰을 즉시 가져가 all-false 로 빠지면, 기존 조건
  // (!dispensing && tokenAtGate)이 영영 안 맞아 타임아웃 → 방출 실패 오탐이었다.
  it('토큰을 봤다가 all-false 로 빠짐(오버배출/사용자 회수) → COMPLETE', () => {
    // 실제 트레이스: [모터+센서1·2] → [all-false]
    expect(
      feedAll([{ dispensing: true, tokenAtMid: true, tokenAtGate: true }, {}]),
    ).toBe('COMPLETE');
  });

  it('핵심: 같은 all-false 현재상태도 prev 에 따라 갈린다', () => {
    // 직전이 이송로에 있었으면(배출됨) → COMPLETE
    expect(evaluateTransition(status(), t, status({ tokenAtMid: true }))).toBe(
      'COMPLETE',
    );
    // 직전도 비어 있었으면(아직 시작 전) → IN_PROGRESS
    expect(evaluateTransition(status(), t, status())).toBe('IN_PROGRESS');
  });

  it('관측→전이→완료 시퀀스: dispensing → 중간 센서 → all-false = IN_PROGRESS,IN_PROGRESS,COMPLETE', () => {
    expect(feedAll([{ dispensing: true }])).toBe('IN_PROGRESS');
    expect(feedAll([{ dispensing: true }, { tokenAtMid: true }])).toBe(
      'IN_PROGRESS',
    );
    expect(feedAll([{ dispensing: true }, { tokenAtMid: true }, {}])).toBe(
      'COMPLETE',
    );
  });
});

describe('dispenseTransition — 에러 우선순위 (기존 isError 보존)', () => {
  it.each([
    ['tokenJam', { tokenJam: true }],
    ['dispenseError', { dispenseError: true }],
    ['tokenOverlap', { tokenOverlap: true }],
    ['commandNotExecutable', { commandNotExecutable: true }],
    ['tokenEmpty', { tokenEmpty: true }],
  ])('%s 는 ERROR', (_name, flag) => {
    expect(first(flag)).toBe('ERROR');
  });

  it('에러는 완료 조건보다 우선한다: 게이트 홀딩이어도 잼이면 ERROR', () => {
    expect(first({ tokenAtHopper: true, tokenJam: true })).toBe('ERROR');
  });

  it('직전에 이송로에 있던 토큰이 빠졌어도 tokenEmpty 면 ERROR (호퍼 소진 판정 보존)', () => {
    expect(feedAll([{ dispensing: true }, { tokenEmpty: true }])).toBe('ERROR');
  });
});

describe('dispenseToMidTransition — 중간 정지 완료는 모터 정지까지', () => {
  const enter = (over: Partial<DispenserStatus>): TransitionResult =>
    evaluateTransition(status(over), dispenseToMidTransition, null);

  // 잼 회귀 박제: 장비가 세우는 비트는 명령 방향마다 다른데 완료 조건이 한쪽만 봐서,
  // 토큰이 중간 센서에 닿는 순간 모터가 도는 채로 COMPLETE 가 났다. 그 위로 회수가
  // 들어가 토큰이 두 센서에 걸친 채 멈췄다 — tokenJam 도 안 서서 조용히 실패했다.
  it('실측 잼 트레이스: dispensing + 호퍼·중간 센서 는 아직 IN_PROGRESS', () => {
    expect(
      enter({ dispensing: true, tokenAtMid: true, tokenAtGate: true }),
    ).toBe('IN_PROGRESS');
  });

  it('중간 센서 에 닿아도 모터가 돌면 완료가 아니다', () => {
    expect(enter({ dispensing: true, tokenAtMid: true })).toBe('IN_PROGRESS');
    expect(enter({ collecting: true, tokenAtMid: true })).toBe('IN_PROGRESS');
  });

  it('모터 정지 + 중간 센서 도달 → COMPLETE', () => {
    expect(enter({ tokenAtMid: true })).toBe('COMPLETE');
  });

  it('모터가 멈춰도 중간 센서 미도달이면 IN_PROGRESS (인입 대기)', () => {
    expect(enter({})).toBe('IN_PROGRESS');
    expect(enter({ tokenAtHopper: true })).toBe('IN_PROGRESS');
  });

  it('실측 인입 시퀀스가 정확히 한 번만 완료된다', () => {
    // 실측 로그 그대로: 물림 → 모터 회전 → 중간 센서 도달(모터 유지) → 정지
    expect(enter({ tokenAtHopper: true })).toBe('IN_PROGRESS');
    expect(enter({ dispensing: true, tokenAtHopper: true })).toBe(
      'IN_PROGRESS',
    );
    expect(
      enter({ dispensing: true, tokenAtMid: true, tokenAtGate: true }),
    ).toBe('IN_PROGRESS');
    expect(enter({ tokenAtMid: true, tokenAtGate: true })).toBe('COMPLETE');
  });

  it.each([
    ['tokenJam', { tokenJam: true }],
    ['dispenseError', { dispenseError: true }],
    ['tokenOverlap', { tokenOverlap: true }],
    ['commandNotExecutable', { commandNotExecutable: true }],
  ])('%s 는 ERROR — 모터·센서 판정보다 우선', (_name, flag) => {
    expect(enter({ ...flag, tokenAtMid: true })).toBe('ERROR');
  });
});

describe('isCommandBlocked — 사전 검사 · 리셋 대기 공용 술어', () => {
  it('정상 상태는 막지 않는다', () => {
    expect(isCommandBlocked(status())).toBe(false);
  });

  it.each([
    ['commandNotExecutable'],
    ['tokenJam'],
    ['dispenseError'],
    ['returnError'],
  ] as const)('%s 는 새 명령을 막는다', (flag) => {
    expect(isCommandBlocked(status({ [flag]: true }))).toBe(true);
  });

  it.each([
    ['tokenEmpty'],
    ['tokenPreEmpty'],
    ['hopperFull'],
    ['hopperPreFull'],
    ['returnBoxFull'],
    ['tokenOverlap'],
    ['dispensing'],
    ['collecting'],
    ['tokenAtHopper'],
  ] as const)('%s 는 명령 수락과 무관하다 (소모품·진행 상태)', (flag) => {
    expect(isCommandBlocked(status({ [flag]: true }))).toBe(false);
  });
});
