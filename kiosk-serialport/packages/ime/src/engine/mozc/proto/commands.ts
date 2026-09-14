// mozc commands.proto 부분집합 코덱. 필드번호/enum 값은 proto 정본에서 채록:
// https://github.com/google/mozc/blob/master/src/protocol/commands.proto
// https://github.com/google/mozc/blob/master/src/protocol/candidate_window.proto
// 파이프 페이로드 = Input 직렬화 그대로, 응답 = Output (Command 래핑 없음 — client.cc 실측).
// 요청은 우리가 보내는 닫힌 집합만 인코드하고, 응답은 필요한 필드만 디코드(나머지 skip).

import {
  atEnd,
  type Cursor,
  concatBytes,
  cursorOf,
  lenField,
  readBytes,
  readString,
  readTag,
  readVarint,
  skipField,
  stringField,
  toInt32,
  toUint32,
  varintField,
  WIRE_TYPE,
} from './wire';

// proto enum 값 (commands.proto 채록)

/** Input.CommandType — 우리가 쓰는 부분집합. */
export const INPUT_TYPE = {
  CREATE_SESSION: 1,
  DELETE_SESSION: 2,
  SEND_KEY: 3,
  SEND_COMMAND: 5,
  NO_OPERATION: 14, // 서버 ping 용도로 명시된 no-op
  SET_REQUEST: 17, // 클라이언트 프로파일(모바일 모드 등) 설정
} as const;

/** SessionCommand.CommandType — 우리가 쓰는 부분집합. */
export const SESSION_COMMAND_TYPE = {
  REVERT: 1, // ESC 여러 번과 동등(조합 폐기)
  SUBMIT: 2, // Enter 와 동등(현재 조합 확정)
  SELECT_CANDIDATE: 3, // id 로 후보 선택(후보창 닫힘) — 마우스/터치 클릭용
  SUBMIT_CANDIDATE: 7, // id 로 후보 확정
  // 세션은 IME off(DIRECT) 로 시작한다(스파이크 실측: status.activated=false → 키 미소비).
  // 실사용에선 TIP 가 켜주는 부분이라 우리가 세션 생성 직후 명시적으로 켜야 한다.
  TURN_ON_IME: 22,
} as const;

/** KeyEvent.SpecialKey — 우리가 쓰는 부분집합. */
export const SPECIAL_KEY = {
  SPACE: 4,
  ENTER: 5,
  ESCAPE: 10,
  BACKSPACE: 12,
} as const;
export type MozcSpecialKey = keyof typeof SPECIAL_KEY;

/** Output.ErrorCode.SESSION_FAILURE — EvalCommand 실패 표식. */
export const SESSION_FAILURE = 1;

// 요청(우리 JSON) → Input 바이트

export type MozcKey =
  | { kind: 'codePoint'; codePoint: number } // 인쇄 가능 키(UCS4) → KeyEvent.key_code
  | { kind: 'special'; key: MozcSpecialKey }; // 비인쇄 키 → KeyEvent.special_key

export type MozcSessionCommand =
  | { type: 'SELECT_CANDIDATE' | 'SUBMIT_CANDIDATE'; candidateId: number }
  | { type: 'SUBMIT' }
  | { type: 'REVERT' }
  | { type: 'TURN_ON_IME' };

/**
 * commands.Request 부분집합 — 클라이언트 UI 프로파일.
 * mixed_conversion=true 가 "모바일 모드": 변환/음역 후보까지 타이핑 중 후보창에 실려
 * 탭 확정(SUBMIT_CANDIDATE)이 주 경로가 된다(스페이스 문절 변환 불필요).
 * 주의(실측): SET_REQUEST 는 세션이 아니라 서버 전역에 스티키 — 재시작 전까지 유지되므로
 * 세션 생성마다 명시적으로 쏴서 결정적으로 만든다.
 */
export type MozcRequestConfig = {
  mixedConversion: boolean;
  /** 후보창 페이지 크기(스트립 폭 기준). */
  candidatePageSize: number;
};

/** 세션 id 는 서버가 발급하는 uint64 — JS number 로는 불안전해서 bigint 고정(jstype=JS_STRING 근거). */
export type MozcRequest =
  | { type: 'CREATE_SESSION' }
  | { type: 'DELETE_SESSION'; sessionId: bigint }
  | { type: 'SEND_KEY'; sessionId: bigint; key: MozcKey }
  | { type: 'SEND_COMMAND'; sessionId: bigint; command: MozcSessionCommand }
  | { type: 'SET_REQUEST'; sessionId: bigint; request: MozcRequestConfig }
  | { type: 'NO_OPERATION' };

// Input 필드번호: type=1, id=2, key=3, command=4, request=9
const INPUT_FIELD = { TYPE: 1, ID: 2, KEY: 3, COMMAND: 4, REQUEST: 9 } as const;
// KeyEvent 필드번호: key_code=1, special_key=3
const KEY_EVENT_FIELD = { KEY_CODE: 1, SPECIAL_KEY: 3 } as const;
// SessionCommand 필드번호: type=1, id=2(int32 — 후보 id 는 음수 가능)
const SESSION_COMMAND_FIELD = { TYPE: 1, ID: 2 } as const;
// Request 필드번호: zero_query_suggestion=1(의도적 미사용 — CN 과 동작 일관),
// mixed_conversion=2, candidate_page_size=15
const REQUEST_FIELD = { MIXED_CONVERSION: 2, CANDIDATE_PAGE_SIZE: 15 } as const;

function encodeKeyEvent(key: MozcKey): Uint8Array {
  return key.kind === 'codePoint'
    ? varintField(KEY_EVENT_FIELD.KEY_CODE, key.codePoint)
    : varintField(KEY_EVENT_FIELD.SPECIAL_KEY, SPECIAL_KEY[key.key]);
}

function encodeSessionCommand(command: MozcSessionCommand): Uint8Array {
  const type = varintField(
    SESSION_COMMAND_FIELD.TYPE,
    SESSION_COMMAND_TYPE[command.type],
  );
  return command.type === 'SELECT_CANDIDATE' ||
    command.type === 'SUBMIT_CANDIDATE'
    ? concatBytes(
        type,
        varintField(SESSION_COMMAND_FIELD.ID, command.candidateId),
      )
    : type;
}

/** 요청 1건 → 파이프에 실을 Input 직렬화 바이트. */
export function encodeInput(req: MozcRequest): Uint8Array {
  switch (req.type) {
    case 'CREATE_SESSION':
      return varintField(INPUT_FIELD.TYPE, INPUT_TYPE.CREATE_SESSION);
    case 'DELETE_SESSION':
      return concatBytes(
        varintField(INPUT_FIELD.TYPE, INPUT_TYPE.DELETE_SESSION),
        varintField(INPUT_FIELD.ID, req.sessionId),
      );
    case 'SEND_KEY':
      return concatBytes(
        varintField(INPUT_FIELD.TYPE, INPUT_TYPE.SEND_KEY),
        varintField(INPUT_FIELD.ID, req.sessionId),
        lenField(INPUT_FIELD.KEY, encodeKeyEvent(req.key)),
      );
    case 'SEND_COMMAND':
      return concatBytes(
        varintField(INPUT_FIELD.TYPE, INPUT_TYPE.SEND_COMMAND),
        varintField(INPUT_FIELD.ID, req.sessionId),
        lenField(INPUT_FIELD.COMMAND, encodeSessionCommand(req.command)),
      );
    case 'SET_REQUEST':
      return concatBytes(
        varintField(INPUT_FIELD.TYPE, INPUT_TYPE.SET_REQUEST),
        varintField(INPUT_FIELD.ID, req.sessionId),
        lenField(
          INPUT_FIELD.REQUEST,
          concatBytes(
            varintField(
              REQUEST_FIELD.MIXED_CONVERSION,
              req.request.mixedConversion ? 1 : 0,
            ),
            varintField(
              REQUEST_FIELD.CANDIDATE_PAGE_SIZE,
              req.request.candidatePageSize,
            ),
          ),
        ),
      );
    case 'NO_OPERATION':
      return varintField(INPUT_FIELD.TYPE, INPUT_TYPE.NO_OPERATION);
    default:
      // 닫힌 집합 소진 증명 — 요청 variant 추가 시 컴파일 에러로 표면화.
      return req satisfies never;
  }
}

// Output 바이트 → 우리 JSON

export type MozcCandidate = {
  /** 후보창 내 표시 순번(전역 index — 페이징 시 첫 후보가 0이 아닐 수 있음). */
  index: number;
  value: string;
  /** SELECT/SUBMIT_CANDIDATE 에 쓰는 고유 id(음수 가능). 서버가 안 채우면 null. */
  id: number | null;
};

export type MozcCandidateWindow = {
  /** 하이라이트된 후보의 전역 index. suggestion 단계에선 없음(null). */
  focusedIndex: number | null;
  /** 전체 후보 수(이 창에 다 실리지 않을 수 있음). */
  size: number;
  candidates: readonly MozcCandidate[];
};

export type MozcPreedit = {
  cursor: number;
  /** 세그먼트 문자열들(조합 표시는 join 으로 충분— annotation 은 우리 UI 미사용). */
  segments: readonly string[];
};

export type MozcOutput = {
  /** CREATE_SESSION 응답의 세션 id. */
  id: bigint | null;
  consumed: boolean;
  /** Output.ErrorCode — SESSION_FAILURE(1)면 세션층 실패. */
  errorCode: number;
  /** 확정 텍스트(Result.value). 없으면 null. */
  result: string | null;
  preedit: MozcPreedit | null;
  candidateWindow: MozcCandidateWindow | null;
};

// Output 필드번호: id=1, consumed=3, result=4, preedit=5, candidate_window=6, error_code=11
const OUTPUT_FIELD = {
  ID: 1,
  CONSUMED: 3,
  RESULT: 4,
  PREEDIT: 5,
  CANDIDATE_WINDOW: 6,
  ERROR_CODE: 11,
} as const;

// Result 필드번호: value=2
const RESULT_FIELD = { VALUE: 2 } as const;

// Preedit 필드번호: cursor=1, Segment=group 2 { value=4 }
const PREEDIT_FIELD = { CURSOR: 1, SEGMENT_GROUP: 2 } as const;
const SEGMENT_FIELD = { VALUE: 4 } as const;

// CandidateWindow 필드번호: focused_index=1, size=2, Candidate=group 3 { index=4, value=5, id=9 }
const WINDOW_FIELD = { FOCUSED_INDEX: 1, SIZE: 2, CANDIDATE_GROUP: 3 } as const;
const CANDIDATE_FIELD = { INDEX: 4, VALUE: 5, ID: 9 } as const;

function decodeResult(buf: Uint8Array): string | null {
  const c = cursorOf(buf);
  let value: string | null = null;
  while (!atEnd(c)) {
    const { fieldNumber, wireType } = readTag(c);
    if (fieldNumber === RESULT_FIELD.VALUE && wireType === WIRE_TYPE.LEN) {
      value = readString(c);
    } else {
      skipField(c, wireType);
    }
  }
  return value;
}

/** group 필드(SGROUP 직후부터 EGROUP 까지)를 순회하며 아는 필드만 채집. */
function decodeSegmentGroup(c: Cursor): string {
  let value = '';
  for (;;) {
    const { fieldNumber, wireType } = readTag(c);
    if (wireType === WIRE_TYPE.EGROUP) return value;
    if (fieldNumber === SEGMENT_FIELD.VALUE && wireType === WIRE_TYPE.LEN) {
      value = readString(c);
    } else {
      skipField(c, wireType);
    }
  }
}

function decodePreedit(buf: Uint8Array): MozcPreedit {
  const c = cursorOf(buf);
  let cursor = 0;
  const segments: string[] = [];
  while (!atEnd(c)) {
    const { fieldNumber, wireType } = readTag(c);
    if (fieldNumber === PREEDIT_FIELD.CURSOR && wireType === WIRE_TYPE.VARINT) {
      cursor = toUint32(readVarint(c));
    } else if (
      fieldNumber === PREEDIT_FIELD.SEGMENT_GROUP &&
      wireType === WIRE_TYPE.SGROUP
    ) {
      segments.push(decodeSegmentGroup(c));
    } else {
      skipField(c, wireType);
    }
  }
  return { cursor, segments };
}

function decodeCandidateGroup(c: Cursor): MozcCandidate {
  let index = 0;
  let value = '';
  let id: number | null = null;
  for (;;) {
    const { fieldNumber, wireType } = readTag(c);
    if (wireType === WIRE_TYPE.EGROUP) return { index, value, id };
    if (
      fieldNumber === CANDIDATE_FIELD.INDEX &&
      wireType === WIRE_TYPE.VARINT
    ) {
      index = toUint32(readVarint(c));
    } else if (
      fieldNumber === CANDIDATE_FIELD.VALUE &&
      wireType === WIRE_TYPE.LEN
    ) {
      value = readString(c);
    } else if (
      fieldNumber === CANDIDATE_FIELD.ID &&
      wireType === WIRE_TYPE.VARINT
    ) {
      id = toInt32(readVarint(c));
    } else {
      skipField(c, wireType);
    }
  }
}

function decodeCandidateWindow(buf: Uint8Array): MozcCandidateWindow {
  const c = cursorOf(buf);
  let focusedIndex: number | null = null;
  let size = 0;
  const candidates: MozcCandidate[] = [];
  while (!atEnd(c)) {
    const { fieldNumber, wireType } = readTag(c);
    if (
      fieldNumber === WINDOW_FIELD.FOCUSED_INDEX &&
      wireType === WIRE_TYPE.VARINT
    ) {
      focusedIndex = toUint32(readVarint(c));
    } else if (
      fieldNumber === WINDOW_FIELD.SIZE &&
      wireType === WIRE_TYPE.VARINT
    ) {
      size = toUint32(readVarint(c));
    } else if (
      fieldNumber === WINDOW_FIELD.CANDIDATE_GROUP &&
      wireType === WIRE_TYPE.SGROUP
    ) {
      candidates.push(decodeCandidateGroup(c));
    } else {
      skipField(c, wireType);
    }
  }
  return { focusedIndex, size, candidates };
}

/** 파이프 응답 바이트 → Output 부분집합. 모르는 필드는 전부 skip(전방호환). */
export function decodeOutput(buf: Uint8Array): MozcOutput {
  const c = cursorOf(buf);
  const output: MozcOutput = {
    id: null,
    consumed: false,
    errorCode: 0,
    result: null,
    preedit: null,
    candidateWindow: null,
  };
  while (!atEnd(c)) {
    const { fieldNumber, wireType } = readTag(c);
    if (fieldNumber === OUTPUT_FIELD.ID && wireType === WIRE_TYPE.VARINT) {
      output.id = readVarint(c);
    } else if (
      fieldNumber === OUTPUT_FIELD.CONSUMED &&
      wireType === WIRE_TYPE.VARINT
    ) {
      output.consumed = readVarint(c) !== 0n;
    } else if (
      fieldNumber === OUTPUT_FIELD.RESULT &&
      wireType === WIRE_TYPE.LEN
    ) {
      output.result = decodeResult(readBytes(c));
    } else if (
      fieldNumber === OUTPUT_FIELD.PREEDIT &&
      wireType === WIRE_TYPE.LEN
    ) {
      output.preedit = decodePreedit(readBytes(c));
    } else if (
      fieldNumber === OUTPUT_FIELD.CANDIDATE_WINDOW &&
      wireType === WIRE_TYPE.LEN
    ) {
      output.candidateWindow = decodeCandidateWindow(readBytes(c));
    } else if (
      fieldNumber === OUTPUT_FIELD.ERROR_CODE &&
      wireType === WIRE_TYPE.VARINT
    ) {
      output.errorCode = toUint32(readVarint(c));
    } else {
      skipField(c, wireType);
    }
  }
  return output;
}
