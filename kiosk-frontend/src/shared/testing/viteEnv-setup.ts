/**
 * bun test 용 vite 환경변수 보정 preload.
 *
 * `bun test` 는 NODE_ENV 만 'test' 로 세우고 `import.meta.env.MODE` 는 비워 둔다(vite 가
 * 주입하는 값이라 bun 런타임엔 없다). 그런데 런타임 코드는 vite 기준으로 `MODE` 를 보므로,
 * 보정하지 않으면 테스트가 프로덕션 분기를 타 버린다 — 실제로 romanize.ts 의 kuromoji 사전
 * 경로가 CDN 으로 떨어져, 네트워크가 없으면 일본어 로마자 변환이 조용히 실패한 채(에러는
 * catch 되어 로그만) 스위트가 통과했다. 판독이 사라진 걸 아무도 모르는 위양성 통과였다.
 *
 * bun 은 `import.meta.env` 를 `process.env` 로 매핑하므로 여기서 MODE 를 세우면 런타임
 * 코드에 테스트 전용 분기를 더하지 않고 전제를 맞출 수 있다.
 */
process.env.MODE ??= 'test';
