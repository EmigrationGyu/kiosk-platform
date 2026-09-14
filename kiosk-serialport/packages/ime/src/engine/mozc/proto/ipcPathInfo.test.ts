import { describe, expect, it } from 'bun:test';
import { decodeIpcPathInfo, sessionPipePathOf } from './ipcPathInfo';

const fromHex = (hexStr: string): Uint8Array =>
  Uint8Array.from(
    hexStr.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );

// 실기기 골든 픽스처: mozc_server 3.34.6239.100 이 실제로 남긴
// %USERPROFILE%\AppData\LocalLow\Mozc\session.ipc 원본 바이트(2026-07-28 채록).
const REAL_SESSION_IPC =
  '0a28333030653230376135326639653863363033316233323365366661343539656264666336303166' +
  '331080c70118947320032a0d332e33342e363233392e313030';

describe('decodeIpcPathInfo', () => {
  it('실서버 session.ipc 골든 디코드', () => {
    expect(decodeIpcPathInfo(fromHex(REAL_SESSION_IPC))).toEqual({
      key: '300e207a52f9e8c6031b323e6fa459ebdfc601f3',
      protocolVersion: 3,
      productVersion: '3.34.6239.100',
      processId: 25472,
    });
  });

  it('빈 버퍼 = 기본값(상위에서 key 부재로 실패 수렴)', () => {
    expect(decodeIpcPathInfo(new Uint8Array(0))).toEqual({
      key: '',
      protocolVersion: 0,
      productVersion: '',
      processId: 0,
    });
  });
});

describe('sessionPipePathOf', () => {
  it('실측 파이프 경로 조립: \\\\.\\pipe\\mozc.<key>.session', () => {
    expect(sessionPipePathOf('abc123')).toBe(
      '\\\\.\\pipe\\mozc.abc123.session',
    );
  });
});
