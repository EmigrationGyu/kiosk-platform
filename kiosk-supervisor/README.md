# kiosk-supervisor

키오스크 박스를 **1회 설치 후 영구적으로 살아있게 + 스스로 최신 상태로 유지**시키는 Windows 서비스. 현장 기사가 박스마다 수동 업데이트하러 다니던 문제를 없애는 게 목표다.

> 키오스크 Electron 앱(`kiosk-electron`, `Kiosk`)과는 **별개 설치물**이다. 이 레포는 그 앱을 **담거나 실행하지 않고**, 감시·재기동하며, 자기 자신을 자동 업데이트하는 *워치독*이다.

---

## 무엇을 하나

1. **자가 최신화** — 제품 로직(`daemon.js`)과 감시 로직(`loader.js`)을 S3 에서 받아 서명 검증 후 교체. 나쁜 버전은 자동 롤백.
2. **키오스크 감시** — 키오스크 Electron 앱의 heartbeat 를 named pipe 로 받다가, 끊기면 작업 스케줄러로 재기동.
3. **오프라인 생존** — 네트워크가 없어도 캐시된 버전으로 계속 동작. 도달 실패는 에러가 아니라 정상 경로.

운영 중 사람 손·UAC 는 **0회** (설치 1회 제외).

---

## 어떻게 도나 — 3계층

```
bun.exe (동결 런타임, USB)
 └ NSSM 서비스 → bun.exe bootstrap.js
     bootstrap.js   loader.js 를 감시/업데이트/롤백        [동결 — USB 로만 갱신]
       └ loader.js     daemon.js 를 감시/업데이트/롤백 + 자기 heartbeat   [S3 자동 갱신]
           └ daemon.js     키오스크 감시 등 제품 로직 + 자기 heartbeat       [S3 자동 갱신]
               └ 키오스크 Electron 앱   (별도 Squirrel 설치물)
```

**핵심 원리 — 복구 앵커 분리:** "자동 업데이트되는 것"과 "그걸 복구하는 것"은 반드시 다른 아티팩트여야 한다. 나쁜 업데이트가 복구 수단까지 망가뜨리면 벽돌이 되기 때문. 그래서:

- 나쁜 `daemon.js` → **loader** 가 `daemon.js.previous` 로 롤백
- 나쁜 `loader.js` → **bootstrap** 이 `loader.js.previous` 로 롤백 ← *loader 버그를 USB 없이 원격 수정 가능하게 하는 핵심*
- 나쁜 `bootstrap.js`/`bun.exe` → 복구 불가 → 그래서 **최대한 작고 단순하게 유지하고 USB 로만 교체**(거의 영원히 안 함). 최악에도 벽돌이 아니라 캐시본으로 degrade.

각 계층은 동일한 패턴이라 로직을 한 번만 작성해 공유한다:
- **`supervisor-core.ts`** — 자식 하나를 fetch→검증→교체→spawn→워치독→롤백 (bootstrap·loader 공용)
- **`heartbeat.ts`** — stdout 으로 `@@HB@@` 한 줄 송신 (loader·daemon 공용). 부모는 자식 stdout 에서 이 접두 라인을 heartbeat 로 인식하고, 그 외 라인은 로그로 위로 흘린다.

### 자동 업데이트 흐름 (예: daemon)

1. loader 가 30분(±10% 지터)마다 `DAEMON_MANIFEST_URL`(S3 `latest.json`) 폴링
2. 로컬 버전과 다르고 negative-cache 에 없으면 → 다운로드 → **sha256 + 서명 검증**(WebCrypto, RSASSA-PKCS1-v1_5/SHA-256, 임베드 공개키)
3. 검증 통과 → `daemon.js`→`daemon.js.previous` 백업 후 교체 → daemon 재기동
4. **기동 게이트**: 30초 내 첫 heartbeat 없으면(또는 가동 중 heartbeat 30초 끊기면) → kill → previous 로 롤백 + negative-cache 기록
5. 네트워크 실패 시 조용히 캐시본 유지 (오프라인 정상 경로)

### 키오스크 감시 (daemon → kiosk)

- 키오스크 backend(electron 메인 프로세스 안)가 named pipe `\\.\pipe\kiosk-electron` **서버**를 열고 `kiosk-alive` heartbeat 송신, daemon 이 **클라이언트**로 접속해 수신 (SYSTEM 이 만든 서버 pipe 엔 비승격 키오스크가 못 붙어 EPERM → 역할 반전)
- daemon 이 30초 끊기면 죽음으로 판정 → `taskkill /F /T /IM`(좀비/중복 reap) → `schtasks /run /tn Kiosk` 로 **사용자 세션(Session 1)에 재기동** (서비스는 Session 0 라 GUI 직접 spawn 불가 — schtasks 가 세션 다리). 키오스크가 제거됐으면(`app-*\exe` 소실) task 제거 후 재시도 중단
- 키오스크 작업(`Kiosk`) 생성·보수·제거는 **daemon(SYSTEM)이 소유**(`daemon/kiosk-task.ts` `ensureKioskTask`/`removeKioskTask`) — heartbeat 의 launch 정보로 멱등 등록. electron 은 더 이상 작업을 건드리지 않음

---

## 디렉토리 구조

```
src/
  bootstrap.ts        # 동결 엔트리 — supervisor-core(loader.js)
  loader.ts           # 엔트리 — heartbeat + supervisor-core(daemon.js)
  supervisor-core.ts  # 제네릭 update+supervise+rollback (bootstrap·loader 공용)
  heartbeat.ts        # @@HB@@ 송신 (loader·daemon 공용)
  types.ts            # 매니페스트 / heartbeat / negative-cache zod 스키마
  constants.ts        # 식별자·경로·인터벌·매니페스트 URL·공개키·버전 (빌드 시 일부 주입)
  daemon/
    index.ts          # 엔트리 — heartbeat + 키오스크 감시
    ipc.ts            # named pipe 수신 (Bun.listen)
    kiosk-watch.ts    # 키오스크 워치독 → schtasks 재기동
scripts/
  release.ts          # CI: build→sha256→서명→manifest→S3 업로드 (loader/daemon)
  package.ts          # USB ZIP 패키저 (bootstrap 로컬빌드 + S3 최신 번들)
installer/
  install.ps1         # 자가 elevation NSSM 설치 (UTF-8 BOM)
  uninstall.ps1       # 제거 (키오스크 작업은 안 건드림)
  bun.exe / nssm.exe  # 동봉 바이너리
.github/workflows/
  release.yml         # master 수동 dispatch → release.ts
```

런타임 의존성: **node:* / 외부 lib 미사용** (Bun 네이티브 + 웹표준 글로벌만). zod 만 dep.

---

## 명령어

```bash
bun install
bun run build       # bootstrap.js + loader.js + daemon.js → dist/ (로컬, placeholder 값)
bun run typecheck
bun run package     # USB ZIP 조립 (S3 게시 후 실행 — dist/kiosk-supervisor-<ver>.zip)
```

릴리스(서명+S3 업로드)는 CI 가 수행 — 로컬에서 직접 하지 않음(개인키 비노출).

---

## CI/CD (GitHub Actions, `release.yml`)

- 트리거: **master 에서 수동 `workflow_dispatch`** (master 외 거부)
- 버전: S3 의 기존 최신에서 **minor bump** (git push 불필요)
- `scripts/release.ts` 가 loader.js/daemon.js 를 빌드(임베드 값 `--define` 주입)→sha256→**개인키 서명**→manifest 작성→S3 업로드
- 개인키 = GitHub Secret `SUPERVISOR_SIGNING_KEY` (PKCS8 PEM). 공개키 = `constants.ts` 의 `PUBLIC_KEYS` 에 커밋 (다중 키 = 회전 대비)
- S3: `s3://<KIOSK_APP_BUCKET_NAME>/kiosk-supervisor/{loader,daemon}/<ver>/` (immutable 캐시) + `.../latest.json` (no-cache). **버킷 프리픽스가 공개 읽기**여야 박스가 무자격 fetch 가능
- AWS = 기존 OIDC 역할(`AWS_DEPLOY_ROLE_ARN`), 리전 ap-northeast-2

배포 후엔 **S3 에 push 하면 전 박스가 자동 갱신** (현장 방문 0).

---

## 설치

USB ZIP 의 `install.ps1` 우클릭 → "PowerShell로 실행" → UAC 1회. NSSM 이 `bun.exe bootstrap.js` 를 LocalSystem 자동시작 서비스로 등록 + 크래시 복구(AppExit=Restart, AppRestartDelay/Throttle) + SCM `sc failure`. 재실행해도 안전(idempotent).

키오스크 앱은 별도로 `Kiosk-Setup.exe`(Squirrel) 를 설치 — 그게 heartbeat 송신부(backend)를 담당. `Kiosk` 작업 등록은 supervisor daemon 이 그 heartbeat 를 받아 처리한다.

---

## 절대 깨면 안 되는 것 (불변식)

- 자식이 부모를 살리는 코드 금지 (순환 — 현재 문제의 원인)
- `supervisor-core`/`bootstrap` 에 제품 로직 넣기 금지 (프로즌 코어 비대 = 버그 위험)
- 서명 검증 생략 금지 (S3 키 유출 시 전국 임의코드 실행)
- 롤백 안전망 없이 배포 금지
- `bootstrap.js`/`bun.exe` 자가 업데이트 구현 금지 (복구 앵커 자가 업데이트 = 벽돌)
- `constants.ts` 의 `INSTALL_DIR`/`SERVICE_NAME`/`KIOSK_TASK_NAME` ↔ `install.ps1`/`uninstall.ps1` 값은 항상 일치 (`KIOSK_TASK_NAME` 은 daemon 의 단일 진실 공급원 — electron 측 복제 없음)

---

## 현재 상태

- 3계층 + CI/CD + 키오스크 heartbeat/작업 연동 코드 완료, 한 박스에 설치되어 서비스 RUNNING (daemon v0.4.0)
- 자동업데이트 인프라(공개 읽기·서명·캐시·실제 키페어 체인) 검증 완료
- **남은 검증은 [`VERIFICATION.md`](./VERIFICATION.md) 참고** — 특히 라이브 자동업데이트/롤백/키오스크 연동은 박스에서 미검증
