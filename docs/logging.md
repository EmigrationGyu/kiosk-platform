# 로그 — 파일은 하나, 쓰는 주체도 하나 (상세)

> CLAUDE.md 의 요약본에서 갈라져 나온 근거 문서. 규칙 자체는 CLAUDE.md 가 정본이고, 여기는 **왜 그렇게 정했는지**를 남긴다.


로그 파일에 **쓰는 프로세스는 백엔드 하나뿐입니다.** 프로세스마다 자기 파일을 열면 같은
사건의 앞뒤가 대여섯 개 파일에 흩어져, 무엇이 무엇을 유발했는지 읽으려면 사람이 손으로
합쳐야 합니다(같은 파일에 둘이 append 하면 줄이 섞이므로 갈랐던 것이고, 그 대가였습니다).

```
[producer]  Logger ──▶ LogSink (주입)        ← "누가 읽는지" 모른다
                          │  어댑터만 토폴로지를 안다
                          ▼
[transport] stdout | file | (미래) ipc·http
                          │
                          ▼
[writer]    LogService.ingest(LogRecord)     ← "어떻게 왔는지" 모른다
```

| 층 | 어디 | 아는 것 |
|----|------|--------|
| 계약 | `types/src/log.ts` | `LogRecord`·`LOG_ORIGIN`·codec·포맷터. 4패키지 공통 |
| producer | `serialport/shared/Logger` | 레코드를 만든다. 경로도 포맷도 모른다 |
| 어댑터 | `shared/Logger/impl/*` (`@log/Sink`) | 레코드가 어디로 나가는지 |
| writer | `backend/LogService` | 파일. 레코드가 어떻게 왔는지는 모른다 |

- **서브프로세스에서 파일을 열지 마세요.** 레코드를 만들어 sink 에 넘기면 됩니다. 어댑터는
  `@log/Sink` alias 로 swap 됩니다(tsconfig·vite·esbuild 3곳 — `@ipc/Router` 와 같은 규약).
- **출처는 파일명이 아니라 `origin` 필드가 집니다.** 닫힌 집합이라 **새 출처는 `LOG_ORIGIN`
  에 등록해야 파일에 뜹니다** — 안 그러면 경계에서 거절돼 조용히 사라집니다.
- **시각은 producer 가 찍습니다.** 받는 쪽이 도착 시각으로 찍으면 파이프를 타고 온 자식
  로그가 자기 프로세스 안의 순서를 잃습니다.
- **`ingest` 는 레벨을 다시 거르지 않습니다.** 거르면 자기 레벨을 따로 두는
  producer(suprema 의 기본 debug)가 통째로 사라집니다. 필터는 만드는 쪽 몫입니다.

### stdout 을 로그 채널로 쓸 때

자식의 stdout 에는 로그와 그 밖의 신호(`[ready]`·번들러 잡음)가 같이 흐릅니다. 프레이밍된
줄만 걷어내고 나머지는 콘솔로 흘립니다 — 이 규약은 codec 안에만 있습니다.

**`utilityProcess.fork` 는 `stdio` 기본값이 `inherit` 이라 `proc.stdout` 이 `null` 입니다**
(Electron API 계약). `stdio: ['ignore','pipe','pipe']` 를 넘기지 않으면 `proc.stdout?.on(...)`
이 아무 에러 없이 안 걸리고, 패키징된 앱에서 자식 로그가 아무 데도 남지 않습니다.

### `electron-main.log` 만 따로입니다

메인은 **백엔드로 가는 전송이 끊긴 상황을 진단하는 것**이 존재 이유라, 그 전송에 얹으면
정작 필요할 때 아무것도 남지 않습니다. 의도적인 분리이므로 통합 제안 대상이 아닙니다.
줄의 모양은 같은 포맷터를 쓰므로 두 파일을 나란히 읽을 수 있습니다.

