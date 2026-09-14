// protobuf wire format 원시 계층(proto2) — mozc commands 부분집합에 필요한 만큼만.
// 외부 protobuf 라이브러리 대신 손코덱을 쓰는 이유: 닫힌 부분집합이라 타입을 좁힐 수 있고,
// 골든 바이트 픽스처로 박제하기 쉬우며, .proto 런타임 로딩/코드젠 의존이 없다.
// 디코더는 unknown-field skip(그룹 포함)으로 전방호환 — Output 은 거대하고 버전마다 자란다.

export const WIRE_TYPE = {
  VARINT: 0,
  FIXED64: 1,
  LEN: 2,
  SGROUP: 3, // group 시작(deprecated 인코딩이지만 mozc Preedit.Segment/CandidateWindow.Candidate 가 사용)
  EGROUP: 4, // group 끝
  FIXED32: 5,
} as const;
export type WireType = (typeof WIRE_TYPE)[keyof typeof WIRE_TYPE];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// 인코딩

/**
 * varint 인코딩. 음수(int32/int64 필드)는 proto2 규약대로 64비트 2의 보수로 확장해 10바이트가 된다.
 */
export function varint(value: number | bigint): Uint8Array {
  let v = BigInt.asUintN(64, BigInt(value));
  const bytes: number[] = [];
  do {
    const chunk = Number(v & 0x7fn);
    v >>= 7n;
    bytes.push(v === 0n ? chunk : chunk | 0x80);
  } while (v !== 0n);
  return Uint8Array.from(bytes);
}

export function tag(fieldNumber: number, wireType: WireType): Uint8Array {
  return varint((fieldNumber << 3) | wireType);
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** varint 필드 1개 (tag + value). */
export function varintField(
  fieldNumber: number,
  value: number | bigint,
): Uint8Array {
  return concatBytes(tag(fieldNumber, WIRE_TYPE.VARINT), varint(value));
}

/** length-delimited 필드 1개 (tag + len + payload). 서브메시지/바이트열용. */
export function lenField(fieldNumber: number, payload: Uint8Array): Uint8Array {
  return concatBytes(
    tag(fieldNumber, WIRE_TYPE.LEN),
    varint(payload.length),
    payload,
  );
}

/** UTF-8 문자열 필드 1개. */
export function stringField(fieldNumber: number, value: string): Uint8Array {
  return lenField(fieldNumber, textEncoder.encode(value));
}

// 디코딩

/** 진행 위치를 가진 디코딩 커서. pos 만 국소 변이한다(파싱 표준형). */
export type Cursor = { readonly buf: Uint8Array; pos: number };

export const cursorOf = (buf: Uint8Array): Cursor => ({ buf, pos: 0 });

export const atEnd = (c: Cursor): boolean => c.pos >= c.buf.length;

/** varint 1개 읽기. 64비트 초과/절단이면 throw (손상 입력은 상위에서 실패로 수렴). */
export function readVarint(c: Cursor): bigint {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    const byte = c.buf[c.pos];
    if (byte === undefined) throw new Error('[MozcWire] varint 절단');
    c.pos += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7n;
  }
  throw new Error('[MozcWire] varint 10바이트 초과');
}

/** proto uint32 필드 값으로 변환. */
export const toUint32 = (v: bigint): number => Number(BigInt.asUintN(32, v));

/** proto int32 필드 값으로 변환(음수 = 64비트 2의 보수 인코딩). */
export const toInt32 = (v: bigint): number => Number(BigInt.asIntN(32, v));

export function readTag(c: Cursor): {
  fieldNumber: number;
  wireType: WireType;
} {
  const raw = toUint32(readVarint(c));
  return { fieldNumber: raw >>> 3, wireType: (raw & 0x7) as WireType };
}

/** LEN 페이로드 읽기(서브메시지/문자열/바이트열 공용). */
export function readBytes(c: Cursor): Uint8Array {
  const length = toUint32(readVarint(c));
  if (c.pos + length > c.buf.length) throw new Error('[MozcWire] LEN 절단');
  const out = c.buf.subarray(c.pos, c.pos + length);
  c.pos += length;
  return out;
}

export function readString(c: Cursor): string {
  return textDecoder.decode(readBytes(c));
}

/**
 * 모르는 필드 1개 건너뛰기. SGROUP 은 같은 필드번호의 EGROUP 까지 재귀적으로 소비한다
 * (그룹 안에 또 그룹/서브메시지가 올 수 있음).
 */
export function skipField(c: Cursor, wireType: WireType): void {
  switch (wireType) {
    case WIRE_TYPE.VARINT:
      readVarint(c);
      return;
    case WIRE_TYPE.FIXED64:
      c.pos += 8;
      return;
    case WIRE_TYPE.LEN:
      readBytes(c);
      return;
    case WIRE_TYPE.SGROUP: {
      for (;;) {
        if (atEnd(c)) throw new Error('[MozcWire] group 절단');
        const inner = readTag(c);
        if (inner.wireType === WIRE_TYPE.EGROUP) return;
        skipField(c, inner.wireType);
      }
    }
    case WIRE_TYPE.EGROUP:
      // 대응하는 SGROUP 없이 나타난 EGROUP — 손상 입력.
      throw new Error('[MozcWire] 고아 EGROUP');
    case WIRE_TYPE.FIXED32:
      c.pos += 4;
      return;
    default:
      // 닫힌 집합 소진 증명 — 새 와이어타입이 생기면 컴파일 에러로 표면화.
      return wireType satisfies never;
  }
}
