import { describe, expect, it } from 'bun:test';
import { decodeOutput, encodeInput } from './commands';
import {
  concatBytes,
  lenField,
  stringField,
  tag,
  varintField,
  WIRE_TYPE,
} from './wire';

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// encodeInput: 골든 바이트 박제
// 기대 hex 는 commands.proto 필드번호/enum 값으로 손계산한 정본. 실서버 검증은
// 스파이크(실제 왕복)가 담당하고, 여기서는 인코딩 회귀를 바이트 단위로 잠근다.

describe('encodeInput 골든 바이트', () => {
  it('CREATE_SESSION → Input{type=1}', () => {
    expect(hex(encodeInput({ type: 'CREATE_SESSION' }))).toBe('0801');
  });

  it('NO_OPERATION → Input{type=14}', () => {
    expect(hex(encodeInput({ type: 'NO_OPERATION' }))).toBe('080e');
  });

  it('DELETE_SESSION → Input{type=2, id}', () => {
    expect(hex(encodeInput({ type: 'DELETE_SESSION', sessionId: 1n }))).toBe(
      '08021001',
    );
  });

  it('SEND_KEY 인쇄키 → Input{type=3, id, key{key_code}}', () => {
    expect(
      hex(
        encodeInput({
          type: 'SEND_KEY',
          sessionId: 1n,
          key: { kind: 'codePoint', codePoint: 0x61 }, // 'a'
        }),
      ),
    ).toBe('080310011a020861');
  });

  it('SEND_KEY 특수키 → key{special_key=BACKSPACE(12)}', () => {
    expect(
      hex(
        encodeInput({
          type: 'SEND_KEY',
          sessionId: 1n,
          key: { kind: 'special', key: 'BACKSPACE' },
        }),
      ),
    ).toBe('080310011a02180c');
  });

  it('SELECT_CANDIDATE → Input{type=5, id, command{type=3, id}}', () => {
    expect(
      hex(
        encodeInput({
          type: 'SEND_COMMAND',
          sessionId: 1n,
          command: { type: 'SELECT_CANDIDATE', candidateId: 5 },
        }),
      ),
    ).toBe('08051001220408031005');
  });

  it('음수 후보 id 는 64비트 2의 보수 varint', () => {
    expect(
      hex(
        encodeInput({
          type: 'SEND_COMMAND',
          sessionId: 1n,
          command: { type: 'SELECT_CANDIDATE', candidateId: -2 },
        }),
      ),
    ).toBe('08051001220d080310feffffffffffffffff01');
  });

  it('SUBMIT / REVERT → command{type=2/1} (id 없음)', () => {
    expect(
      hex(
        encodeInput({
          type: 'SEND_COMMAND',
          sessionId: 1n,
          command: { type: 'SUBMIT' },
        }),
      ),
    ).toBe('0805100122020802');
    expect(
      hex(
        encodeInput({
          type: 'SEND_COMMAND',
          sessionId: 1n,
          command: { type: 'REVERT' },
        }),
      ),
    ).toBe('0805100122020801');
  });

  it('TURN_ON_IME → command{type=22} (세션은 IME off 로 시작 — 스파이크 실측)', () => {
    expect(
      hex(
        encodeInput({
          type: 'SEND_COMMAND',
          sessionId: 1n,
          command: { type: 'TURN_ON_IME' },
        }),
      ),
    ).toBe('0805100122020816');
  });

  it('SET_REQUEST 모바일 프로파일 → Input{type=17, id, request{mixed=2, page=15}}', () => {
    expect(
      hex(
        encodeInput({
          type: 'SET_REQUEST',
          sessionId: 1n,
          request: { mixedConversion: true, candidatePageSize: 9 },
        }),
      ),
    ).toBe('081110014a0410017809');
  });

  it('uint64 최대 세션 id 무손실', () => {
    const max = 2n ** 64n - 1n;
    expect(hex(encodeInput({ type: 'DELETE_SESSION', sessionId: max }))).toBe(
      '080210ffffffffffffffffff01',
    );
  });
});

// decodeOutput: 합성 버퍼 + unknown 내성
// Preedit.Segment / CandidateWindow.Candidate 는 proto group 인코딩(wire type 3/4).

const segmentGroup = (value: string): Uint8Array =>
  concatBytes(
    tag(2, WIRE_TYPE.SGROUP),
    varintField(3, 1), // annotation (미사용 → skip 경로)
    stringField(4, value),
    varintField(5, value.length), // value_length (미사용 → skip 경로)
    tag(2, WIRE_TYPE.EGROUP),
  );

const candidateGroup = (
  index: number,
  value: string,
  id?: number,
): Uint8Array =>
  concatBytes(
    tag(3, WIRE_TYPE.SGROUP),
    varintField(4, index),
    stringField(5, value),
    // annotation 서브메시지(field 7) — 모르는 서브메시지 skip 검증용
    lenField(7, stringField(3, '[全]')),
    ...(id === undefined ? [] : [varintField(9, id)]),
    tag(3, WIRE_TYPE.EGROUP),
  );

describe('decodeOutput', () => {
  it('CREATE_SESSION 응답: 세션 id(bigint)', () => {
    const buf = concatBytes(
      varintField(1, 2n ** 53n + 1n), // JS number 불안전 영역의 id
      varintField(11, 0),
    );
    const output = decodeOutput(buf);
    expect(output.id).toBe(2n ** 53n + 1n);
    expect(output.errorCode).toBe(0);
  });

  it('조합 중 응답: consumed + preedit 세그먼트 + 후보창(그룹 인코딩)', () => {
    const buf = concatBytes(
      varintField(1, 7),
      varintField(2, 1), // mode — 미채집 필드 skip
      varintField(3, 1), // consumed
      lenField(
        5,
        concatBytes(
          varintField(1, 2), // cursor
          segmentGroup('きょ'),
          segmentGroup('う'),
        ),
      ),
      lenField(
        6,
        concatBytes(
          varintField(1, 10), // focused_index (전역)
          varintField(2, 3), // size
          candidateGroup(9, '今日', 0),
          candidateGroup(10, '京', -3), // 음수 id
          candidateGroup(11, 'きょう'), // id 미제공
          varintField(6, 0), // position — 미채집 필드 skip
        ),
      ),
      lenField(26, stringField(1, '3.34.6239.100')), // server_version — 미채집
    );
    const output = decodeOutput(buf);
    expect(output.consumed).toBe(true);
    expect(output.preedit).toEqual({ cursor: 2, segments: ['きょ', 'う'] });
    expect(output.candidateWindow).toEqual({
      focusedIndex: 10,
      size: 3,
      candidates: [
        { index: 9, value: '今日', id: 0 },
        { index: 10, value: '京', id: -3 },
        { index: 11, value: 'きょう', id: null },
      ],
    });
    expect(output.result).toBeNull();
  });

  it('확정 응답: Result.value', () => {
    const buf = concatBytes(
      varintField(3, 1),
      lenField(4, concatBytes(varintField(1, 1), stringField(2, '今日'))),
    );
    const output = decodeOutput(buf);
    expect(output.result).toBe('今日');
    expect(output.preedit).toBeNull();
    expect(output.candidateWindow).toBeNull();
  });

  it('세션층 실패: error_code=SESSION_FAILURE', () => {
    const output = decodeOutput(varintField(11, 1));
    expect(output.errorCode).toBe(1);
  });

  it('빈 버퍼 = 전부 기본값', () => {
    expect(decodeOutput(new Uint8Array(0))).toEqual({
      id: null,
      consumed: false,
      errorCode: 0,
      result: null,
      preedit: null,
      candidateWindow: null,
    });
  });
});

// 실서버 골든 픽스처 (mozc_server 3.34.6239.100, 2026-07-28 스파이크 채록)

const fromHex = (hexStr: string): Uint8Array =>
  Uint8Array.from(
    hexStr.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );

describe('decodeOutput 실서버 골든', () => {
  it('suggestion 상태: "kau" 타이핑 → preedit かう + 후보 買う', () => {
    const raw =
      '08f684cbc9aa8ee1980a100118012a1a08021318012206e3818be3818628023206e381' +
      '8be38186142000322f10011b20002a06e8b2b7e3818648001c3000580260006a140a12' +
      '546162e382ade383bce381a7e981b8e68a9e9001096a0608011001180172' +
      '12120e080010002206e8b2b7e3818638011802ba0100';
    const output = decodeOutput(fromHex(raw));
    expect(output.id).toBe(734513842237915766n);
    expect(output.consumed).toBe(true);
    expect(output.errorCode).toBe(0);
    expect(output.result).toBeNull();
    expect(output.preedit).toEqual({ cursor: 2, segments: ['かう'] });
    expect(output.candidateWindow).toEqual({
      focusedIndex: null, // suggestion 단계 = 포커스 없음
      size: 1,
      candidates: [{ index: 0, value: '買う', id: 0 }],
    });
  });

  it('SUBMIT_CANDIDATE 확정: result=買う + 조합 종료(preedit/후보창 없음)', () => {
    const raw =
      '08f684cbc9aa8ee1980a10011801222c08011206e8b2b7e381861a06e3818be38186' +
      '20002a160a06e8b2b7e381861206e3818be3818618ad0620ad066a09080110011801d00101';
    const output = decodeOutput(fromHex(raw));
    expect(output.consumed).toBe(true);
    expect(output.result).toBe('買う');
    expect(output.preedit).toBeNull();
    expect(output.candidateWindow).toBeNull();
  });
});
