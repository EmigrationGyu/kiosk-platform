import {
  HARDWARE_EVENTS,
  IME_EVENTS,
  NAMESPACES,
  TOKEN_DISPENSER_EVENTS,
} from 'kiosk-types';

/**
 * Mock 트랜스포트의 응답표 — 백엔드 없이 렌더러만 띄울 때 쓴다(`--mode mock`).
 *
 * 실제 트랜스포트와 **같은 인터페이스**를 구현하므로 화면 코드는 어느 쪽이 꽂혔는지 모른다.
 * 여기 없는 이벤트는 호출 시 throw 한다 — 조용히 `undefined` 를 돌려주면 화면이 "값이
 * 아직 안 온 상태"와 구별하지 못해, 목이 빠진 자리가 로딩 스피너로 위장된다.
 */
type MockHandler = (req: unknown) => unknown;

const emptyStatus = {
  returnBoxFull: false,
  commandNotExecutable: false,
  hopperPreFull: false,
  hopperFull: false,
  dispensing: false,
  collecting: false,
  dispenseError: false,
  returnError: false,
  tokenOverlap: false,
  tokenJam: false,
  tokenPreEmpty: false,
  tokenEmpty: false,
  tokenAtHopper: false,
  tokenAtMid: false,
  tokenAtGate: false,
};

export const mockRegistry: Record<string, Record<string, MockHandler>> = {
  [NAMESPACES.HARDWARE]: {
    [HARDWARE_EVENTS.SCAN]: () => ({ token_dispenser: true }),
    [HARDWARE_EVENTS.WARMUP]: () => ({ ime: true, 'token-dispenser': true }),
  },
  [NAMESPACES.TOKEN_DISPENSER]: {
    [TOKEN_DISPENSER_EVENTS.STATUS]: () => ({
      success: true,
      data: emptyStatus,
    }),
    [TOKEN_DISPENSER_EVENTS.DISPENSE]: (req) => ({
      success: true,
      data: {
        dispensed: (req as { count: number }).count,
        status: { ...emptyStatus, tokenAtGate: true },
      },
    }),
    [TOKEN_DISPENSER_EVENTS.RETURN]: () => ({
      success: true,
      data: emptyStatus,
    }),
    [TOKEN_DISPENSER_EVENTS.RESET]: () => ({
      success: true,
      data: emptyStatus,
    }),
  },
  [NAMESPACES.IME]: {
    [IME_EVENTS.PROCESS_KEY]: () => ({
      success: true,
      data: {
        committedText: '',
        preedit: 'ni hao',
        candidates: [{ text: '你好' }, { text: '拟好' }],
        highlightedIndex: 0,
        composing: true,
      },
    }),
    [IME_EVENTS.SELECT_CANDIDATE]: () => ({
      success: true,
      data: {
        committedText: '你好',
        preedit: '',
        candidates: [],
        highlightedIndex: -1,
        composing: false,
      },
    }),
    [IME_EVENTS.CLEAR]: () => ({
      success: true,
      data: {
        committedText: '',
        preedit: '',
        candidates: [],
        highlightedIndex: -1,
        composing: false,
      },
    }),
  },
};
