import { beforeAll, describe, expect, test } from 'bun:test';
import {
  COMPONENT_PUBLIC_KEYS,
  createSignatureVerifier,
  sha256Hex,
} from './signing';

const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

/** 테스트 전용 키 쌍 — 실제 서명키는 CI 시크릿이라 여기서 만들 수 없다. */
async function makeKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { ...ALGO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey('spki', pair.publicKey),
  );
  const b64 = btoa(String.fromCharCode(...spki));
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----`;
  return { privateKey: pair.privateKey, pem };
}

const sign = (key: CryptoKey, data: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.sign(ALGO.name, key, data).then((s) => new Uint8Array(s));

const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

let alice: Awaited<ReturnType<typeof makeKeyPair>>;
let mallory: Awaited<ReturnType<typeof makeKeyPair>>;

beforeAll(async () => {
  alice = await makeKeyPair();
  mallory = await makeKeyPair();
});

describe('서명 검증', () => {
  test('올바른 서명은 통과한다', async () => {
    const verify = createSignatureVerifier([alice.pem]);
    const data = bytes('dist.tar.gz 내용');

    expect(await verify(data, await sign(alice.privateKey, data))).toBe(true);
  });

  test('다른 키로 서명한 것은 거부한다 — 버킷이 열려도 남의 코드는 안 받는다 ★', async () => {
    const verify = createSignatureVerifier([alice.pem]);
    const data = bytes('dist.tar.gz 내용');

    expect(await verify(data, await sign(mallory.privateKey, data))).toBe(
      false,
    );
  });

  test('바이트가 한 글자만 달라도 거부한다', async () => {
    const verify = createSignatureVerifier([alice.pem]);
    const signature = await sign(alice.privateKey, bytes('원본'));

    expect(await verify(bytes('원본!'), signature)).toBe(false);
  });

  test('회전 중에는 두 키가 함께 유효하다 ★', async () => {
    // 새 키를 앞에 넣고 옛 키를 한 세대 남긴다 — 안 그러면 옛 키오스크가 전부 막힌다.
    const verify = createSignatureVerifier([mallory.pem, alice.pem]);
    const data = bytes('dist.tar.gz 내용');

    expect(await verify(data, await sign(alice.privateKey, data))).toBe(true);
    expect(await verify(data, await sign(mallory.privateKey, data))).toBe(true);
  });

  test('동봉된 공개키는 실제로 import 된다 — 오타나면 모든 업데이트가 막힌다 ★', async () => {
    const verify = createSignatureVerifier(COMPONENT_PUBLIC_KEYS);

    // 검증은 실패하지만(우리 키로 서명한 게 아니므로) import 는 성공해야 한다.
    const data = bytes('x');
    expect(await verify(data, await sign(alice.privateKey, data))).toBe(false);
  });
});

describe('sha256', () => {
  test('알려진 값과 일치한다', async () => {
    // echo -n "" | sha256sum
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('소문자 hex 64자다 — 서술자 스키마가 그 형식을 요구한다', async () => {
    expect(await sha256Hex(bytes('아무거나'))).toMatch(/^[0-9a-f]{64}$/);
  });
});
