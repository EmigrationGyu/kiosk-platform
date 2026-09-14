# Kiosk V3 — AI & Developer Guide

## bun을 사용하세요

- backend와 serial-port 프로세스의 개발 환경 실행에만 npm을 사용합니다.
- 그 외의 빌드, 패키지 매니저, 테스트등 다른 기능들은 npm에 의존하지 말고 모두 bun을 사용하세요.

## 설계 철학

이 프로젝트는 **"부수는 것보다 따르는 게 더 쉬운 설계"** 를 목표로 설계되었습니다.

- 실제 동작하는 인프라 코드(Router, Transport, Channel 등)는 내부에 숨겨져 있습니다. **이 코드들을 수정할 필요가 없습니다.**
- 개발자는 **타입, 스키마, 핸들러만 정의**하면 나머지는 프레임워크가 처리합니다.
- 각 레이어에 4~5개의 안전장치(타입 체크 → Zod 검증 → frozen handlers → FSM 전이 제약 → 에러 복구 파이프라인)가 있어, 설계를 우회하는 것보다 따르는 것이 항상 더 쉽습니다.

## 작업 순서

1. 순수 함수로 작성하세요.
2. 1번에서 테스트로 박제할 수 있는건 가능한 많이 박제 하세요.
3. 박제할 수 없는 부수효과는 경계로 밀어내세요.

---

## 엄격한 규칙

### 1. 백엔드 무상태성 (Stateless Backend)

백엔드는 **엄격하게 무상태**여야 합니다. 백엔드에 전역 상태를 저장하거나 캐싱하지 마세요.

### 2. 서버 상태와 클라이언트 상태의 분리

서버 상태(DB, API에서 오는 데이터)와 클라이언트 상태(UI, 로컬 상태)는 **의도적으로 분리**되어 있습니다.

- **서버 상태를 클라이언트 상태(Zustand 등)에 복사하는 행위는 엄격히 금지됩니다.**
- 서버 상태는 **반드시 Apollo Client만을 통해** 접근해야 합니다. 이렇게 해야 서버 설정이 변경되었을 때 클라이언트에서 즉시 반영됩니다.
- 각종 객체나 스토어 내부에 서버 상태를 `set`하는 것은 금지됩니다.

```
// 금지: 서버 데이터를 로컬 스토어에 복사
const { data } = useQuery(GET_ACCOMMODATION);
useEffect(() => {
  accommodationStore.set(data); // 절대 하지 마세요
}, [data]);

// 올바름: Apollo Client에서 직접 사용
const { data } = useQuery(GET_ACCOMMODATION);
return <div>{data.accommodation.name}</div>;
```

### 3. 함수형 프로그래밍 우선

가능한 한 함수형 프로그래밍을 적용하세요.

- 순수 함수를 우선하고, 부수 효과를 최소화하세요.
- 불변 데이터를 기본으로 사용하세요.
- 클래스보다 함수 합성을 선호하세요 (인프라 레이어 제외).

### 4. 선택 가능한 영역은 A11yNode로 감싸기

버튼, 인풋, Pressable 등 **사용자가 선택/조작할 수 있는 모든 영역에는 `A11yNode`를 씌워야 합니다.** (음성 안내·접근성 바인딩이 A11yNode를 통해 연결됩니다.)

### 5. 버튼은 너비를 명시하기

**대부분의 버튼은 자리를 공평하게 나눠 채우도록(50/50 등) 의도**되어 있습니다. flex item의 `min-width:auto` 기본값 때문에 너비를 명시하지 않으면 긴 텍스트(특히 다국어)에서 버튼이 콘텐츠만큼 늘어나 레이아웃이 깨지거나 글자가 넘칩니다.

- 쌍둥이/균등 버튼은 각 버튼(또는 그 컬럼)에 **`flex-1 min-w-0`** (또는 `w-full min-w-0`)를 명시하세요.
- 그래야 `AutoFitText`가 정해진 폭 안에서 글자 크기를 자동 축소할 수 있습니다.
- 의도적으로 "콘텐츠만큼만 점유"하는 버튼은 그대로 두면 됩니다(이 경우 축소 없이 늘어남).

### 6. 주석은 코드가 말할 수 없는 것만

코드를 한국어로 옮겨 적은 주석은 코드가 바뀌면 거짓말이 되고, 읽는 사람이 그걸 검증할 방법이 없습니다.

**남길 것**

| 종류 | 예 |
|------|-----|
| 실측·사고 이력 | `` `load` 는 폰트·로티까지 기다려 4.3초 늦었다(실측) `` |
| 기각된 대안과 그 이유 | `did-start-loading 으로 내렸더니 false 로 걸린 채 복구되지 않았다` |
| 미문서화된 외부 계약 | `utilityProcess.fork 의 stdio 기본값은 inherit 이라 stdout 이 null 이다` |
| 비직관적 순서·타이밍 제약 | `동기로 내려가면 이중 spawn 이 된다` |
| 수치의 근거 | `supervisor 가 30초에 재기동하므로 되감기 2회가 그 안에 들어야 한다` |
| `TODO` · 기획 대기 | |

**지울 것**

- 코드를 한국어로 옮긴 줄 (`count++` 위의 `// 카운트 증가`)
- 타입 시그니처에 이미 있는 `@param` · `@returns`
- 섹션 배너 (`// ===== 상태 =====`)
- 스캐폴딩·템플릿이 남긴 영어 주석 (`// Create the browser window.`)

**길이** — 근거 하나당 1~3줄. 단락이 여럿 필요하면 그건 주석이 아니라 문서이므로 `docs/` 로
옮기고 한 줄 링크만 남기세요.

**두는 자리** — 설명하는 대상 바로 위. 타입 하나를 설명하는 척하며 모듈 전체를 설명하는 블록은
파일 맨 위로 올리세요.
---

## 아키텍처 개요

```
Frontend (React 19 + Vite)
  ↕ Socket.IO (개발) / Electron IPC (프로덕션)
Backend (Node.js + Socket.IO)
  ↕ Express-IPC (Named Pipes)
Serialport Subprocess (독립 프로세스)
  ↕ Serial Port
Hardware Device
```

### 패키지 구조

| 패키지 | 역할 |
|-------|------|
| `kiosk-types` | 공유 타입, Zod 스키마, EventMap 정의 (모든 패키지의 단일 진실 공급원) |
| `kiosk-backend` | Socket.IO 서버, 비즈니스 로직, 하드웨어 트랜스포트 |
| `kiosk-frontend` | React UI, Apollo GraphQL, Zustand 상태관리 |
| `kiosk-serialport` | 하드웨어별 독립 서브프로세스 (카드키, 현금, 영수증) |

### 통신 흐름

```
[Frontend Transport] → Socket.IO → [Backend Channel] → [Router] → [Controller] → [Service]
                                                                        ↓
                                              [Hardware Transport] → IPC → [Serialport Subprocess]
                                                                              ↓
                                                                    [Serial Port → Device]
```

---

## 새 하드웨어 이벤트 추가하기

새 이벤트를 기존 네임스페이스에 추가하는 방법입니다.

### Step 1: 타입 정의 (`kiosk-types`)

**`src/events/{feature}.ts`** 에서 이벤트 상수와 EventMap에 추가:

```typescript
// 이벤트 상수 추가
export const CARDKEY_DISPENSER_EVENTS = {
  ISSUE_CARD: '/issue_card',
  READ_CARD: '/read_card',
  NEW_EVENT: '/new_event',       // 추가
} as const;

// Zod 요청 스키마 추가
export const CardkeyDispenserSchemas = {
  ...
  [CARDKEY_DISPENSER_EVENTS.NEW_EVENT]: NewEventRequestSchema,  // 추가
};

// Zod 응답 스키마 추가
export const CardkeyDispenserResponseSchemas = {
  ...
  [CARDKEY_DISPENSER_EVENTS.NEW_EVENT]: resultSchema(NewEventResultSchema),  // 추가
};

// EventMap 타입에 추가
export type CardkeyDispenserEventMap = {
  ...
  [CARDKEY_DISPENSER_EVENTS.NEW_EVENT]: {
    request: z.infer<typeof NewEventRequestSchema>;
    response: Result<z.infer<typeof NewEventResultSchema>, CardkeyDispenserCause>;
  };
};
```

### Step 2: 백엔드 핸들러 (`kiosk-backend`)

**`src/controller/{Feature}Controller.ts`** 에서 핸들러 추가:

```typescript
const handlers = {
  ...
  [EVENTS.NEW_EVENT]: withErrorHandler(async (req, res) => {
    const result = await this.service.newEvent(req);
    return res.ok(SUCCESS_CODE.OK, result);
  }, 'Failed to process new event'),
} satisfies ControllerHandlers<FeatureEventMap>;
```

> `satisfies ControllerHandlers<...>` 가 타입 안전성을 보장합니다. 빠뜨린 이벤트가 있으면 컴파일 에러가 발생합니다.

### Step 3: 프론트엔드에서 호출

```typescript
const transport = new CardkeyDispenser();
const result = await transport.request(TRANSPORT_EVENT.NEW_EVENT, requestData);
```

> Router, Channel, Transport 내부 코드는 수정할 필요가 없습니다. 타입과 스키마만 정의하면 자동으로 연결됩니다.

---

## 새 도메인/하드웨어 추가하기 — `bun gen`

새 도메인이나 하드웨어 디바이스의 보일러플레이트는 **루트에서 생성기 한 번**으로 만듭니다. 정의는 `kiosk-types` 에 한 번만 생성되고, 소비 레포(backend/frontend/serialport)에는 re-export + 와이어링이 자동 주입됩니다(과거의 레포별 수동 추가/복제는 폐기).

```bash
bun gen fb   <Name>   # 프론트엔드 ↔ 백엔드 (소켓 도메인)
bun gen bs   <Name>   # 백엔드 ↔ 시리얼포트 (하드웨어 서브프로세스 + electron/dev spawn)
bun gen full <Name>   # 둘 다 (프론트→백→하드웨어 수직 슬라이스)

# 예: bun gen full CardkeyDispenser   (이름은 PascalCase·kebab·snake 무엇이든 됨)
```

### 각 모드가 생성/주입하는 것

| 모드 | types | backend | frontend | serialport | electron / dev |
|------|-------|---------|----------|-----------|----------------|
| `fb` | `events/{name}.ts` + 네임스페이스 + 배럴 | re-export · 컨트롤러(withErrorHandler) · 라우터 · 서비스 · app/Namespaces 와이어링 | re-export · Transport 클래스 | — | — |
| `bs` | `serialport/{name}.ts` + 배럴 + WARMABLE_PROCESSES 편입 | hardwareTransport 싱글턴 · events · 서비스 · WARMUP 워밍 전략 | — | 패키지 스캐폴드(컨트롤러 withErrorHandler) | spawn 함수 · SERIALPORTS 항목 |
| `full` | fb + bs 정의 둘 다 | fb 와이어링 + bs 트랜스포트 + **병합 서비스 1개** + WARMUP 워밍 전략 | Transport | 패키지 | spawn |

> bs/full 모드는 새 서브프로세스를 **프리웜(WARMUP) 경로에도 자동 편입**합니다: types 의
> `WARMABLE_PROCESSES` 닫힌 집합과 backend `HardwareController` 의 워밍 전략 맵(시드 =
> HEALTH_CHECK 왕복)에 함께 주입됩니다. 프론트는 `usePrewarm([...])` 로 플로우 진입 시점에
> 해당 서브프로세스들을 미리 깨울 수 있습니다(스캐너 관할 디바이스로 승격하려면 전략을
> `scannerWarm(DEVICE_IDS.X)` 로 교체).

생성기는 기존 파일의 `// @gen:*` 앵커 마커 앞에 멱등하게 주입합니다 — **이 마커 줄은 지우지 마세요.** 생성 직후 각 서브모듈에서 `biome check --write` 를 돌려 import 정렬을 맞추는 것을 권장합니다(biome 가 import 를 정렬해도 마커는 경계로 유지됩니다).

### 생성 후 채워야 하는 것

생성기는 `PING`/`PORT_ASSIGNED`/`HEALTH_CHECK` 같은 시드 엔드포인트만 만듭니다. 실제 로직은:

1. **types** — `src/events/{name}.ts` / `src/serialport/{name}.ts` 에 실제 EVENTS·스키마·EventMap 추가 (위 "새 하드웨어 이벤트 추가하기" 참고)
2. **service** — 생성된 `{Name}Service` 에 비즈니스 로직 구현. full 모드의 병합 서비스는 프론트 요청을 받아 하드웨어 트랜스포트를 호출하는 글루의 자리입니다.
3. **serialport** — `SerialPortService` 에 디바이스 커맨드/프로토콜 구현. 직렬화가 필요하면 `createSerialMutex` 합성을 사용하세요(생성된 컨트롤러 상단 주석 참고).
4. **부팅 접촉 경로** — 이 서브프로세스에 부팅 중 말을 거는 경로가 있는지 확인하세요. 없으면 원격 업데이트 **승격 검증에서 조용히 빠집니다**(아래 "승격 정책" 참고). 조건부 설치 장치라 일부러 빼는 것은 괜찮지만, **모르고 빠지는 것과 구별되게** 판단해서 결정하세요.

> `packages/_boilerplate/` 는 참고용으로 남아있지만, 새 패키지는 `bun gen bs` 로 만드세요.

### 새 서브프로세스가 닿아야 하는 곳

생성기가 **자동으로 주입**합니다 (마커를 지우지 마세요):

| 대상 | 무엇 |
|------|------|
| types | 프로세스 식별자·파이프 경로 · serialport 배럴 · 계약 레지스트리 · 워밍 대상 |
| backend | 하드웨어 트랜스포트 · 서비스 · 워밍 전략 |
| serialport | 패키지 스캐폴드의 alias 3개 — `@ipc/Router` · `@log/Sink` · `@serial/Port` (vite·esbuild 양쪽) |
| CI | `release-component.yml` 의 컴포넌트 선택지 |

생성기가 `bun run contract` 도 직접 돌려 계약 지문을 다시 굽습니다.

**파생되므로 손댈 필요 없는 것**: 루트 빌드 파이프라인(`packages/*` 스캔) · CI 의 빌드·업로드·다운로드·태그 경로(`SERIALPORT_PROCESS` 에서 파생). 목록을 어딘가에 또 적으면 새 장치가 **조용히 빠집니다**.

**electron·dev 스크립트는 주입 대상이 아닙니다** — 자식 생명주기를 백엔드 `processManager` 가 소유하므로 둘 다 디바이스 목록을 들지 않습니다.

**사람이 판단해야 하는 것은 하나**: 위 "생성 후 채워야 하는 것" 4번(부팅 접촉 경로).

### 새 토폴로지를 추가할 때

업데이트·프로세스 관리 모듈은 **electron 을 import 하지 않고 효과를 주입받습니다.** 새 호스트(예: node 타깃의 supervisor)는 어댑터만 제공하면 됩니다.

| 그대로 이식 | 어댑터 교체 |
|------------|------------|
| `applyEngine` `applyPlan` `generationStore` `backendProcess` `bridgeHost` `spawnService` `readinessWatchdog` `Logger` `LogService` | `electronAdapters` `portBroker` `secureStorageService` `backendHost/index`(합성 루트) `Logger/impl`(`@log/Sink`) `bridge/impl`(`@bridge/Bridge`) |

`forbid-electron` 게이트가 **모든 백엔드 빌드 타깃에 적용**되므로, 경계 위반은 빌드 실패로 드러납니다.

### 부모가 없는 토폴로지

node 타깃(개발·독립 실행)에는 능력을 빌려줄 부모가 없습니다. `@bridge/Bridge` 가 그 사실을
표현하며, **부재를 실패로 번역하지 않습니다** — 갈리는 것은 부재의 *의미*입니다.

| 호출 | 부모가 없으면 |
|------|--------------|
| 알리기만 하는 것 (`RENDERER_ALIVE` `UPDATE_MARK_STABLE` `UPDATE_ROLLBACK`) | 받을 상대가 없다 = 할 일이 없다 → 성공 |
| 부모가 대행하는 것 (`UPDATE_APPLY` `PROCESS_*` `SECURE_*`) | 실제로 불가능 → 실패 |

한쪽으로 몰면 둘 다 사고가 납니다. 전부 실패시키면 렌더러 생존 선언이 **성공할 때까지 5초마다
재시도**하므로 개발 로그가 그 에러로 덮이고(실측: 하루 에러 262줄 중 231줄), 전부 성공시키면
적용이 일어나지 않았는데 일어난 것으로 보여 호출부가 잠근 채 오지 않을 교체를 기다립니다.

`bridge()` 를 `impl/` 밖에서 직접 부르면 이 구분을 우회하게 됩니다 — 그 자리가 곧 토폴로지
누수입니다.

---

## 원격 부분 업데이트 — 승격 정책

세 판정이 **각각 다른 질문에 답합니다.** 섞지 마세요.

| 판정 | 질문 | 신호 | 누가 |
|------|------|------|------|
| 되감기 | 새 백엔드가 **섰는가** | 포트 구독 선언 | 적용 엔진 |
| 승격 | 이 조합이 **도는가** | 아래 근거 | **판정자 하나뿐** |
| 계약 | 서로 **말이 통하는가** | 지문 대조 → 어긋나면 되감기 | 판정자 |

- **승격 주체는 하나입니다.** `last-stable` 을 쓸 수 있는 것은 판정자뿐 — 저장소 API 가 이를
  강제합니다(`writePointer` 는 live 만, 승격은 `promoteLiveToStable` 만). 쓰는 주체가 둘이면
  순서를 맞춰도 경합이 남습니다(실측: 적용이 계약 판정을 8ms 앞질러 어긋난 조합을 "안전"으로
  기록했습니다).
- **판정은 근거가 도착할 때마다** 합니다 — 렌더러 부팅 완주 · 장치 응답 · **포트 재배선**(백엔드가
  갈리면 렌더러가 다시 선언한다). 부팅 완주 한 번만 보면 지연 spawn 장치를 놓칩니다. 결론이 한 번
  나면 더 보지 않습니다.
- **승격 근거는 "소프트웨어가 답했는가"** 지 "하드웨어가 멀쩡한가"가 아닙니다. **봉투가 왔는가**가
  기준이고 내용이 성공인지는 아닙니다 — `연결 실패` 라는 응답도 서브프로세스가 살아서 자기 코드를
  돌렸다는 뜻입니다. **응답이 아예 없는 것**(타임아웃·spawn 실패)만 소프트웨어 문제입니다.
  **안 물어본 프로세스는 무관**합니다.
- 장치는 **접촉될 때** 판정됩니다(첫 사용·프리웜·부팅 기기점검). 교체 직후 강제 접촉하지 않습니다 —
  물리적으로 없는 장치를 깨우면 무응답이 승격을 영영 막습니다.
- 매니페스트에서 **빠진 컴포넌트는 그대로 둡니다**(덮어쓰기). 되돌리려면 `baseline` 을 명시하세요.
- **`dom-ready`·`did-finish-load` 를 "앱이 동작한다"는 사실로 쓰지 마세요.** 이 착각으로 이미 두 번
  사고가 났습니다.

**사각지대**: `kovan-cardpayment` 는 부팅 중 아무도 접촉하지 않아 **검증 없이 승격**됩니다. 근본
원인은 `DEVICE_IDS`(3)·`WARMABLE_PROCESSES`(5)·`SERIALPORT_PROCESS`(6)이 서로 다른 집합인 것 —
"이 키오스크가 실제로 쓰는 장치"를 뜻하는 집합이 없습니다.

> 근거·설계 이유·토폴로지 이식 가이드: [`docs/remote-update.md`](docs/remote-update.md)

---

## 로그 — 파일은 하나, 쓰는 주체도 하나

로그 파일에 **쓰는 프로세스는 백엔드 하나뿐입니다.** 프로세스마다 자기 파일을 열면 같은 사건의
앞뒤가 대여섯 개 파일에 흩어집니다.

```
[producer] Logger ──▶ LogSink (주입) ──▶ stdout|file|… ──▶ LogService.ingest(LogRecord) [writer]
```

| 층 | 어디 | 아는 것 |
|----|------|--------|
| 계약 | `types/src/log.ts` | `LogRecord`·`LOG_ORIGIN`·codec·포맷터 (4패키지 공통) |
| producer | `serialport/shared/Logger` | 레코드를 만든다. 경로도 포맷도 모른다 |
| 어댑터 | `shared/Logger/impl/*` (`@log/Sink`) | 레코드가 어디로 나가는지 |
| writer | `backend/LogService` | 파일. 어떻게 왔는지는 모른다 |

- **서브프로세스에서 파일을 열지 마세요.** 레코드를 sink 에 넘기면 됩니다. 어댑터는 `@log/Sink`
  alias 로 swap 됩니다(tsconfig·vite·esbuild 3곳 — `@ipc/Router` 와 같은 규약).
- **출처는 `origin` 필드가 집니다** — 닫힌 집합이라 새 출처는 `LOG_ORIGIN` 에 등록해야 파일에
  뜹니다. 안 그러면 경계에서 거절돼 조용히 사라집니다.
- **시각은 producer 가 찍습니다.** 받는 쪽이 찍으면 자식 로그가 자기 프로세스 안의 순서를 잃습니다.
- **`ingest` 는 레벨을 다시 거르지 않습니다.** 거르면 자기 레벨을 따로 두는 producer 가 통째로
  사라집니다.
- **`utilityProcess.fork` 는 `stdio` 기본값이 `inherit` 이라 `proc.stdout` 이 `null` 입니다.**
  `stdio: ['ignore','pipe','pipe']` 를 안 넘기면 리스너가 조용히 안 걸리고, 패키징된 앱에서 자식
  로그가 아무 데도 남지 않습니다.
- **`electron-main.log` 만 따로입니다** — 백엔드로 가는 전송이 끊긴 상황을 진단하는 것이 존재
  이유라 그 전송에 얹을 수 없습니다. 의도적 분리이므로 통합 제안 대상이 아닙니다.

> 근거·사고 이력: [`docs/logging.md`](docs/logging.md)

---

## 수정하면 안 되는 인프라 코드

다음 파일들은 프레임워크의 핵심이며, 일반적인 기능 추가/수정 시 변경할 필요가 없습니다:

| 파일 | 역할 |
|------|------|
| `backend/src/router/Router.ts` | Zod 검증 + 핸들러 매칭 + 응답 발신 파이프라인 |
| `backend/src/controller/BaseController.ts` | handlers를 freeze하여 런타임 변조 방지 |
| `backend/src/helpers/channel/impl/*` | Socket.IO/IPC 네임스페이스 바인딩 |
| `backend/src/hardwareTransport/impl/*` | IPC/Electron 환경별 트랜스포트 구현 |
| `frontend/src/shared/transport/impl/*` | Socket.IO/IPC 클라이언트 구현 |
| `types/src/transport.ts` | EventMap, Handler, ControllerHandlers 코어 타입 |

> 이 파일들을 수정해야 할 것 같다면, 설계를 잘못 이해했을 가능성이 높습니다. 타입과 스키마를 정의하는 것만으로 충분합니다.
