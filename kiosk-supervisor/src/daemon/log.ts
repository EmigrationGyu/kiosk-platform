// biome-ignore-all lint/suspicious/noConsole: stdout 로그는 로더가 supervisor.log 로 캡처.
/**
 * daemon 로그 — **시각을 찍는다.** 로더가 `[daemon] <줄>` 로 감싸지만 감싸는 쪽은 자기가 받은
 * 시각밖에 모르므로 만드는 쪽이 찍는다(키오스크 로그와 같은 규칙).
 *
 * 시각이 없어 실제로 못 읽은 적이 있다: 2026-08-28 설치 사고에서 워치독이 여덟 번 발화한 건
 * 보였지만 **첫 발화가 설치 전인지 후인지**를 로그만으로 가릴 수 없었다. 로컬 시각인 것도
 * 의도적이다 — 키오스크 로그가 로컬 시각이라 UTC 로 쓰면 두 파일을 나란히 못 읽는다.
 */

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function log(message: string): void {
  console.log(`${stamp()} [daemon] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error === undefined ? '' : ` ${String(error)}`;
  console.error(`${stamp()} [daemon] ${message}${detail}`);
}
