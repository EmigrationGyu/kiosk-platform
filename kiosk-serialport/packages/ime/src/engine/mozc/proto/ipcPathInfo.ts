// mozc ipc.proto(IPCPathInfo) 디코더 — 서버가 유저프로필에 남기는 `session.ipc` 파일의 내용.
// 여기서 얻은 key 로 세션 파이프 이름을 조립한다(파이프 발견의 유일한 경로).
// 정본: https://github.com/google/mozc/blob/master/src/ipc/ipc.proto

import {
  atEnd,
  cursorOf,
  readString,
  readTag,
  readVarint,
  skipField,
  toUint32,
  WIRE_TYPE,
} from './wire';

export type IpcPathInfo = {
  /** 파이프 이름 키(유저 SID 파생 40hex). */
  key: string;
  /** IPC 프로토콜 버전 — 불일치 시 접속 전에 실패로 표면화하는 용도. */
  protocolVersion: number;
  /** 서버 제품 버전(예: "3.34.6239.100"). */
  productVersion: string;
  /** 서버 프로세스 id — 생존 확인용. */
  processId: number;
};

// IPCPathInfo 필드번호: key=1, process_id=2, thread_id=3, protocol_version=4, product_version=5
const FIELD = {
  KEY: 1,
  PROCESS_ID: 2,
  PROTOCOL_VERSION: 4,
  PRODUCT_VERSION: 5,
} as const;

/** session.ipc 파일 바이트 → IPCPathInfo 부분집합. */
export function decodeIpcPathInfo(buf: Uint8Array): IpcPathInfo {
  const c = cursorOf(buf);
  const info: IpcPathInfo = {
    key: '',
    protocolVersion: 0,
    productVersion: '',
    processId: 0,
  };
  while (!atEnd(c)) {
    const { fieldNumber, wireType } = readTag(c);
    if (fieldNumber === FIELD.KEY && wireType === WIRE_TYPE.LEN) {
      info.key = readString(c);
    } else if (
      fieldNumber === FIELD.PROCESS_ID &&
      wireType === WIRE_TYPE.VARINT
    ) {
      info.processId = toUint32(readVarint(c));
    } else if (
      fieldNumber === FIELD.PROTOCOL_VERSION &&
      wireType === WIRE_TYPE.VARINT
    ) {
      info.protocolVersion = toUint32(readVarint(c));
    } else if (
      fieldNumber === FIELD.PRODUCT_VERSION &&
      wireType === WIRE_TYPE.LEN
    ) {
      info.productVersion = readString(c);
    } else {
      skipField(c, wireType);
    }
  }
  return info;
}

/** 세션 파이프 전체 경로. 접두사 "mozc."는 OSS 브랜딩 고정(실측: \\.\pipe\mozc.<key>.session). */
export function sessionPipePathOf(key: string): string {
  return `\\\\.\\pipe\\mozc.${key}.session`;
}
