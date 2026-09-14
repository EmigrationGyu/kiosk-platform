/**
 * 산출물 진위 검증 — 공개 버킷에서 받은 바이트를 믿을 유일한 근거.
 *
 * 버킷이 public read 이므로 **읽는 것은 누구나** 할 수 있다. 지금은 CI 만 쓸 수 있지만,
 * 언젠가 정책이 잘못 열리면 키오스크가 남의 코드를 설치한다. sha256 만으로는 못 막는다 —
 * 산출물을 바꾼 쪽이 서술자의 해시도 같이 바꾸면 된다.
 *
 * 공개키는 **electron 번들에 박혀 있다.** 컴포넌트 업데이트로는 바꿀 수 없다는 뜻이고,
 * 그래야 승인당하는 쪽이 자기를 승인하는 키를 갈아치우지 못한다. 키 회전은 전체 앱
 * 설치로만 일어난다.
 *
 * 배열인 이유는 회전이다 — 새 키를 앞에 넣고 한 세대 지난 뒤 옛 키를 뺀다.
 */
const SIGN_ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

export const COMPONENT_PUBLIC_KEYS: readonly string[] = [
  `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyBApjn+rBxhj+jHKG34Y
+i/T6YOnqPe22lVuZrY8BlysAuUcQpoapfB08hDt/y3SlDqTzFIM3vVMgpOYzJmv
LwQ/Z97JYf9nAcDs/J1xBEsgVgheXPuRHqILmmMRFyyBx2UXpQlVYlyAEzrvaRt5
3LcpYqwjEDKw42JpiguJG+G02kuaSptiJbt+Rl/V/qu0w5nn2Hi1fmUBzFvEN+RY
JN2RVI+nzegIRKBwzK9MkuywolJGKsB0mHceETyvePoKn4SuhqPsTGoVS5fPf9PK
56i0433qcMhyDyblm10oagPEIJT1RKS9FOAVDZ0y6o+KWXHm/GbNithKjcr2v33U
gwIDAQAB
-----END PUBLIC KEY-----`,
];

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) der[i] = bin.charCodeAt(i);
  return der.buffer;
}

/**
 * 주어진 공개키들 중 **하나라도** 맞으면 통과 — 회전 중에는 두 키가 함께 유효하다.
 * 키를 주입받으므로 테스트가 자기 키 쌍으로 검증할 수 있다.
 */
export function createSignatureVerifier(publicKeyPems: readonly string[]) {
  let cached: CryptoKey[] | null = null;

  return async function verify(
    data: Uint8Array<ArrayBuffer>,
    signature: Uint8Array<ArrayBuffer>,
  ): Promise<boolean> {
    if (!cached) {
      cached = await Promise.all(
        publicKeyPems.map((pem) =>
          crypto.subtle.importKey('spki', pemToDer(pem), SIGN_ALGO, false, [
            'verify',
          ]),
        ),
      );
    }
    for (const key of cached) {
      if (await crypto.subtle.verify(SIGN_ALGO.name, key, signature, data)) {
        return true;
      }
    }
    return false;
  };
}

/** sha256 hex. 서술자가 말한 값과 대조한다. */
export async function sha256Hex(
  data: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
