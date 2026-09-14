# kiosk-platform

호텔 무인 체크인 키오스크의 클라이언트 소프트웨어. 한 대의 미니 PC 안에서 렌더러·백엔드·장치
서브프로세스가 각자 프로세스로 돌고, 현장에 사람이 가지 않고도 일부 컴포넌트만 원격으로
갈아끼울 수 있다.

**이 저장소는 공개용으로 다시 만든 것이다.** 벤더 프로토콜·업장 데이터·사내 인프라 주소는
전부 걷어냈고, 하드웨어는 같은 구조의 가상 장치로 대체했다. 남은 것은 설계와 그 근거다.

> **설계 의도와 근거는 [ARCHITECTURE.md](./ARCHITECTURE.md) 에 있다.** 이 문서는 돌려보는 법만 적는다.
> 코드를 고칠 때 지켜야 하는 규칙은 [CLAUDE.md](./CLAUDE.md).

---

## 레포 구조

단일 저장소이고, `kiosk-*` 네 개가 bun 워크스페이스다(`kiosk-serialport/packages/*` 포함).

| 디렉터리 | 역할 | 워크스페이스 |
|---|---|:--:|
| `kiosk-types` | 공유 타입·Zod 스키마·EventMap — 네 패키지의 단일 진실 공급원 | ✅ |
| `kiosk-backend` | Socket.IO 서버 · 비즈니스 로직 · 하드웨어 트랜스포트 · 업데이트 엔진 | ✅ |
| `kiosk-frontend` | React 19 + Vite 렌더러 | ✅ |
| `kiosk-serialport` | 장치별 독립 서브프로세스 (`packages/ime` · `token-dispenser` · `outbox`) | ✅ |
| `kiosk-electron` | 데스크톱 셸 — 위 산출물을 묶어 `.exe` 로 패키징 | — |
| `kiosk-supervisor` | 부트/감시 외부 데몬 (별도 라이프사이클) | — |
| `update-console` | 원격 업데이트 지시를 쏘는 운영 콘솔 (별도 앱) | — |
| `scripts` | dev 오케스트레이터 · 생성기 · 빌드 파이프라인 | — |
| `docs` | [로그](./docs/logging.md) · [원격 부분 업데이트](./docs/remote-update.md) 상세 |  |

워크스페이스가 아닌 것들(`kiosk-electron` · `kiosk-supervisor` · `update-console`)은 각자
의존성과 lockfile을 가지므로 해당 디렉터리에서 따로 `bun install` 해야 한다. `bun run dev`
에는 필요 없다.

---

## 돌려보기

```bash
bun install
bun run dev
```

`=== dev stack ready ===` 배너가 뜨면 준비 완료다. **하드웨어는 필요 없다** — 시리얼 장치는
기본이 시뮬레이터이고, 포트 열거부터 바이트 왕복까지 같은 경계(`@serial/Port`)로 갈린다.

기동 순서는 백엔드 → 프론트엔드이고, **장치 서브프로세스는 백엔드가 첫 요청 때 lazy 로
띄운다.** 각 프로세스의 stdout/stderr는 `[name]` 접두와 색으로 한 터미널에 병합된다.

| 키 | 동작 |
|---|---|
| `b` | 백엔드(+서브프로세스) 재시작 — 비정상 종료·재연결·재탐지(`PORT_ASSIGNED`) 경로 검증용 |
| `r` | 코어 재시작 (프론트엔드는 유지 — Vite HMR로 충분) |
| `q` · `Ctrl+C` | 전체 종료. 자식 프로세스 트리까지 정리 (Windows `taskkill /T /F`) |

재시작 중에 또 눌러도 중복 실행되지 않는다(`restartInFlight` 가드).

### 볼 것

| 화면 | 무엇을 밟는가 |
|---|---|
| `/ime` | 키 입력 → 순수 편집 모듈 → 트랜스포트 → IPC → 서브프로세스 → FFI → **실제 입력기 엔진** → 후보 |
| `/dispenser` | 방출/회수 → 서비스 게이트 → IPC → 시리얼 프레임 → FSM 전이. 요청은 **원인 식별자만** 받는다 |
| `/global-ui` | 모달·토스트·키보드·idle 경고 — 화면이 소유하지 않는 전역 층들 |
| `/update` | 컴포넌트별 세대·계약 지문·승격 판정 상태 |

```bash
bun run test          # 전 패키지 — 1,371 케이스
bun gen full Demo     # 생성기 — 전 레포에 수직 슬라이스가 꽂힌다
```

---

## 입력기 엔진 (중국어·일본어) — 직접 받아서 넣어야 합니다

중국어·일본어 조합은 네이티브 엔진을 FFI로 부릅니다. **엔진 바이너리는 이 저장소에 없습니다.**
받아서 아래 경로에 두면 그때부터 동작합니다. 없어도 나머지는 전부 정상이고, 해당 언어를 고르면
후보 자리에 "입력 엔진이 설치되어 있지 않습니다"가 뜹니다.

| 언어 | 엔진 | 두는 곳 | 받는 곳 |
|---|---|---|---|
| 중국어 간·번체 | librime | `~/.kiosk/rime/` — `rime.dll` + 스키마 `*.yaml` | [rime/librime](https://github.com/rime/librime) 릴리스, 스키마는 [rime/rime-luna-pinyin](https://github.com/rime/rime-luna-pinyin) |
| 일본어 | Mozc | `~/.kiosk/mozc/` — `mozc_broker.exe` · `mozc_server.exe` + 동봉 런타임 DLL | [google/mozc](https://github.com/google/mozc) 를 직접 빌드 |

```
~/.kiosk/
├─ rime/
│  ├─ rime.dll
│  ├─ luna_pinyin.schema.yaml   (+ default.yaml, *.dict.yaml, opencc/ ...)
│  └─ user/                     (엔진이 알아서 만듭니다)
└─ mozc/
   ├─ mozc_broker.exe
   ├─ mozc_server.exe
   └─ msvcp140.dll, vcruntime140.dll, ...
```

> **Mozc는 직접 빌드한 바이너리를 넣으세요.** 배포판 설치본에서 꺼낸 파일은 재배포 조건이
> 달라 여기에 동봉하지 않았고, 같은 이유로 내려받을 링크도 걸지 않았습니다.

일본어는 자산이 없어도 **이미 떠 있는 mozc 서버가 있으면 그쪽에 붙습니다**
(`%LOCALAPPDATA%Low\Mozc\session.ipc` 를 읽어 파이프 핑). 위 경로는 그게 없을 때 쓰는
폴백이고, 키오스크 단말에서는 이쪽이 주 경로입니다.

### 놓는 것은 스크립트가 대신합니다

```bash
bun run ime:setup --status                       # 지금 무엇이 깔려 있나
bun run ime:setup --rime <디렉터리|tar.gz> --mozc <디렉터리|tar.gz>
bun run ime:setup --from dist-ime                # ime:bundle 산출물에서 둘 다
bun run ime:setup --rime ... --force             # 이미 있어도 덮어쓰기
```

무엇을 어디에 놓을지는 `IME_ASSET_BUNDLES` 가 정합니다 — 단말에서 백엔드가 CDN 에서 받아
설치할 때와 **같은 상수, 같은 불변식**입니다. 임시 디렉터리에 풀어 핵심 파일을 확인한 뒤에야
제자리로 옮기므로, 엉뚱한 번들을 주면 목적지를 건드리지 않고 거절합니다(반쯤 깔린 엔진이
남지 않습니다). 엔진이 만드는 `user/` 는 옮기지 않습니다 — 다른 기계의 학습 이력이 따라오면
변환 결과가 달라집니다.

넣은 뒤 `bun run dev` 를 다시 띄우면 로그로 확인됩니다:

```
[ime] [Ime] rime engine ready (deploy 완료)
[ime] [Mozc] broker prelaunch 폴백  brokerPath=...\.kiosk\mozc\mozc_broker.exe
[ime] [Mozc] ready  pipe=\\.\pipe\mozc....session
```

---

## 스크립트

| 명령 | 하는 일 |
|---|---|
| `bun run dev` | 전체 dev 스택 기동. 오케스트레이터는 `scripts/dev.ts` 한 파일이고, 각 엔트리가 `[ready]` 를 찍는 것을 감지해 순서를 보장한다 |
| `bun gen <모드> <Name>` | 새 도메인·장치 보일러플레이트 생성 (아래) |
| `bun run package` | 서브레포 빌드 → dist 취합 → 패키징된 앱 (`out/`) |
| `bun run make` | 위 + 설치 파일(`.exe`) 생성 |
| `bun run ime:setup` | 받아둔 입력기 엔진을 `~/.kiosk/` 제자리에 설치 (위 참고) |
| `bun run ime:bundle` | 입력기 자산 번들(tar.gz) 조립 — 재현 가능한 배포 산출물 |

`package` · `make` 는 `--dev` 로 dev 타깃, `--skip-build` 로 기존 dist 재사용.

> 백엔드와 장치 서브프로세스는 dev 에서 `vite-node --watch` 로 도는 사정상 그 실행에만 `npm`
> 을 쓴다. 그 외(빌드·테스트·패키지 매니저)는 전부 `bun`.

### 보일러플레이트 생성 — `bun gen`

정의는 `kiosk-types` 에 한 번만 만들어지고, 소비처(backend/frontend/serialport)에는 re-export
와 와이어링이 자동 주입된다.

```bash
bun gen fb   <Name>   # 프론트엔드 ↔ 백엔드 (소켓 도메인)
bun gen bs   <Name>   # 백엔드 ↔ 시리얼포트 (하드웨어 서브프로세스 + spawn)
bun gen full <Name>   # 둘 다 (프론트→백→하드웨어 수직 슬라이스)
```

기존 파일의 `// @gen:*` 앵커 앞에 **멱등하게** 주입한다 — 그 마커 줄은 지우면 안 된다. 생성기가
닫힌 집합(프로세스 식별자·계약 레지스트리·워밍 대상)까지 함께 채우고 계약 지문을 다시 굽는다.
**사람이 판단해야 하는 것은 하나**뿐이다 — 부팅 중 이 서브프로세스에 말을 거는 경로가 있는가.
없으면 원격 업데이트 승격 검증에서 조용히 빠진다. 모드별 상세는 [CLAUDE.md](./CLAUDE.md).

---

## 빌드·배포

`.github/workflows/` 의 릴리스 워크플로우 세 개는 **원격 부분 업데이트 축의 일부**라 그대로
남겼다 — 컴포넌트별로 빌드해 아티팩트 저장소에 올리고, 단말이 매니페스트를 받아 필요한 것만
교체하는 경로다.

| 워크플로우 | 역할 |
|---|---|
| `release-component.yml` | 컴포넌트 하나만 빌드·업로드 |
| `release-full.yml` | 전체 빌드 → 업로드 → 버전 bump·태그 → electron `.exe` 까지 |
| `release-electron-only.yml` | 이미 올라간 컴포넌트를 내려받아 셸만 재빌드 |

**그대로는 돌지 않는다.** 아티팩트 버킷·배포 자격증명·API 주소가 전부 각자 환경의 것이라,
돌리려면 `AWS_DEPLOY_ROLE_ARN` 등 저장소 시크릿을 자기 것으로 채워야 한다. 사내 주소·식별자는
공개하면서 전부 걷어냈다.

`update-console` 과 `scripts/send-update-command.ts` 도 서버 주소를 소스에 두지 않는다 —
각각 `VITE_HOST_*` 빌드 변수와 `--host`(또는 `KIOSK_HOST`)로 받는다.

판정 규칙(되감기 · 승격 · 계약)과 그 근거는 [docs/remote-update.md](./docs/remote-update.md).

---

## 더 읽을 것

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 왜 이렇게 설계했는가. 제약 · 토폴로지 · 컴파일타임 경계 · 하드웨어 불확실성 · 부분 업데이트
- [CLAUDE.md](./CLAUDE.md) — 코드를 고칠 때 지켜야 하는 규칙
- [docs/remote-update.md](./docs/remote-update.md) — 승격 정책과 사고 이력
- [docs/logging.md](./docs/logging.md) — 로그 writer 가 하나여야 하는 이유
