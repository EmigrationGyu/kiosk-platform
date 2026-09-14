import type { LogRecord } from 'kiosk-types';

/**
 * 만들어진 로그 레코드를 밖으로 내보내는 구멍.
 *
 * Logger 는 이 너머에 무엇이 있는지 모른다 — 부모가 stdout 을 읽는지, 파일로 떨어지는지,
 * 다른 기계로 가는지는 **토폴로지가 고르는 어댑터**의 몫이다. 예전에 Logger 가 직접
 * `os.homedir()/.kiosk/logs` 를 계산하던 자리가 여기로 빠졌다.
 *
 * 환경별 구현은 `@log/Sink` alias 로 swap 된다 (tsconfig·vite·esbuild 3곳, `@ipc/Router` 와 동일).
 */
export type LogSink = {
  write(record: LogRecord): void;
};
