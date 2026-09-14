# `@serial/Port`

시리얼 포트 구현을 **컴파일 시점에** 고르는 alias. 소비처는 `ManagedSerialPort` 하나뿐이고,
그 위 계층(FSM·뮤텍스·폴링 예산·probe)은 어느 쪽이 꽂혔는지 모른다.

| 구현 | 언제 | 무엇 |
|------|------|------|
| `real.ts` | 프로덕션·실장비 개발 | `serialport` 패키지 그대로 |
| `loopback.ts` | 하드웨어 없는 개발·데모·CI | 인프로세스 TD-200 시뮬레이터 |

선언 위치는 세 곳이며 **셋 다 맞춰야 한다** — `tsconfig.json`(타입) · `vite.config.ts`(dev) ·
`esbuild.config.mjs`(빌드). `@ipc/Router`·`@log/Sink` 와 같은 규약이고, `bun gen bs` 가 새
패키지에 이 세 줄을 함께 주입한다.

시뮬레이터가 **모터 지연을 폴 횟수로 흉내내는** 것이 핵심이다. 즉시 완료로 만들면 `needsPrev`
전이도 모터 정지 확인도 한 번도 안 밟혀, 돌아가는데 아무것도 검증하지 않는 데모가 된다.
