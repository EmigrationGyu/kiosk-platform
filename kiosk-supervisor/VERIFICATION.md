# Supervisor 검증 가이드

> 이 문서 하나로 다음 작업자가 "이 프로그램이 정상 작동함을 보장하려면 무엇을 더 테스트해야 하는가"를 파악·실행할 수 있도록 작성했다. 구조/원리는 [`README.md`](./README.md) 참고.

## 0. 시스템 한 줄 요약

3계층 워치독: `bun.exe`(NSSM 서비스) → `bootstrap.js` → `loader.js` → `daemon.js`. 각 층이 아래층을 stdout `@@HB@@` heartbeat 로 감시하고, S3 에서 서명된 신버전을 받아 교체하며, 기동 실패 시 `*.previous` 로 롤백한다. daemon 은 추가로 키오스크 Electron 앱을 named pipe 로 감시하다 죽으면 `schtasks` 로 재기동한다.

## 1. 환경/식별자 (테스트 시 필요)

| 항목 | 값 |
|------|-----|
| 설치 경로 | `C:\Program Files\Kiosk\Supervisor\` |
| 서비스명 | `KioskSupervisor` (LocalSystem, NSSM 래핑) |
| 로그 | `...\Supervisor\supervisor.log` (※ 3프로세스+NSSM 버퍼링으로 기록 지연됨) |
| 상태 파일 | `daemon.js` / `daemon.js.previous` / `daemon.js.version` / `daemon.js.neg.json` (loader 도 동일 패턴) |
| 키오스크 pipe | `\\.\pipe\kiosk-electron` |
| 키오스크 작업 | `Kiosk` (daemon 이 등록·보수·제거) / 앱 = `Kiosk`, `%LocalAppData%\kiosk_electron\` |
| 매니페스트 | `https://kiosk-artifacts-example.s3.ap-northeast-2.amazonaws.com/kiosk-supervisor/{loader,daemon}/latest.json` |
| 인터벌 | 폴링 30분(±10%) / heartbeat 타임아웃 30s / 키오스크 타임아웃 30s / 재기동 유예 30s / spawn backoff 5s |

**테스트 팁 — 빠른 업데이트 체크:** 폴링은 30분이라 느리다. `supervisor-core` 는 **세션 시작마다(spawn 직전) checkForUpdate** 를 하므로, 서비스를 재시작하면(`nssm restart KioskSupervisor` 또는 `sc stop/start`) 즉시 업데이트 체크가 돈다. 또는 테스트 빌드에서 `POLL_INTERVAL_MS` 를 임시로 줄여라.

**테스트용 버전 게시:** master 에서 `release.yml` 수동 실행하면 minor bump 된 새 버전이 서명되어 S3 에 올라간다. "깨진/악성 버전" 테스트는 의도적으로 잘못된 `daemon.js` 를 만들어 (정상 서명으로) 올리거나, `aws s3 cp` 로 직접 올린다.

---

## 2. 이미 검증된 것 (재실행 불필요)

- ✅ Bun named pipe listen/connect (Windows)
- ✅ bootstrap/loader/daemon 빌드·구동, `@@HB@@` 송신
- ✅ `release.ts` build→sign→manifest, 서명 round-trip (throwaway 키)
- ✅ **실제 키페어 end-to-end**: CI(개인키)가 서명한 S3 의 daemon.js 를 임베드 공개키로 verify → `true`
- ✅ S3 공개 읽기 (매니페스트+아티팩트 무자격 fetch 200), 캐시 헤더(immutable/no-cache)
- ✅ `package.ts` ZIP 11파일 정상 산출
- ✅ install.ps1/uninstall.ps1 parse, NSSM 등록, 서비스 RUNNING, 체인 기동(daemon v0.2.0 로그)

→ **즉, "조각"들은 검증됨. 미검증은 "박스 위에서의 라이브 동작/실패 시나리오/키오스크 연동".**

---

## 3. 반드시 추가로 해야 할 테스트 (우선순위 순)

### 🔴 P0 — 핵심 루프 & 안전망 (이게 보장돼야 배포 가능)

#### T1. 라이브 자동 업데이트 (daemon)
- **목표**: S3 에 새 daemon 버전 올리면 박스가 받아 교체·실행하는가.
- **절차**: `release.yml` 실행 → daemon 새 버전(예 0.3.0) 게시 → 박스에서 `nssm restart KioskSupervisor` (또는 30분 대기).
- **기대**: `supervisor.log` 에 `[loader] applied 0.3.0` → daemon `start v0.3.0`. `daemon.js.version` 파일 = 0.3.0.
- **실패 의미**: 폴링/검증/교체 경로 문제. 매니페스트 공개여부·서명·sha 확인.

#### T2. 롤백 — 기동 실패 버전 (daemon)
- **목표**: 부팅 직후 죽거나 heartbeat 안 보내는 daemon 이 올라오면 previous 로 자동 복구되는가.
- **절차**: 일부러 `process.exit(1)` 하거나 heartbeat 를 안 보내는 daemon.js 를 빌드→**정상 서명**→S3 게시 → 서비스 재시작.
- **기대**: 30초 게이트 실패 → `[daemon] rolled back <ver> → <previous>` 로그, `daemon.js` 가 previous 로 복구, `daemon.js.neg.json` 에 실패 버전 기록, 같은 버전 재시도 안 함. 박스는 previous 버전으로 계속 동작.
- **실패 의미**: 롤백/negative-cache 버그 → 나쁜 릴리스가 전 박스 마비 가능. **최우선.**

#### T3. 롤백 — 기동 실패 버전 (loader)
- **목표**: 나쁜 loader.js 를 bootstrap 이 롤백하는가 (= loader 원격 수정의 안전망).
- **절차**: T2 와 동일하되 loader 대상(loader 매니페스트에 게시).
- **기대**: `[loader] rolled back ...` (bootstrap 이 출력), loader 가 previous 로 복구, 박스 계속 동작.

#### T4. 악성/위조 서명 거부 (보안 — 결제장비라 필수)
- **목표**: 서명이 안 맞는 daemon.js 를 박스가 **거부**하고 기존본을 유지하는가.
- **절차**: daemon.js 를 (a) 다른 키로 서명하거나 (b) `.sig` 를 한 바이트 변조해 S3 게시 → 서비스 재시작.
- **기대**: `signature verification failed` 로 거부, `daemon.js` **교체 안 됨**, 기존 버전 계속 실행. (sha256 변조도 동일하게 거부되는지 별도 확인 = T4b)
- **실패 의미**: 검증 우회 = S3 키 유출 시 전국 RCE. 절대 통과하면 안 됨.

### 🟠 P1 — 키오스크 연동 (실제 앱 동작)

#### T5. 키오스크 heartbeat 수신 + 정상 판정
- **선행**: 박스에 `Kiosk` (Squirrel) 설치 + 앱 실행 → heartbeat 수신 시 daemon 이 `Kiosk` 작업 자동 등록(`ensureKioskTask`).
- **목표**: backend 의 `supervisorHeartbeat.ts` 가 보낸 `kiosk-alive` 를 daemon 이 받아 "살아있음"으로 보는가.
- **기대**: 키오스크 실행 중엔 daemon 이 재기동을 **안 함**(로그에 "kiosk heartbeat lost" 없음).

#### T6. 키오스크 사망 → 재기동 (+ Session 1 가시성)
- **목표**: 키오스크를 죽이면 daemon 이 30초 내 감지 → `schtasks /run` 으로 **사용자 화면에** 다시 띄우는가.
- **절차**: 키오스크 실행 중 `taskkill /IM "Kiosk.exe" /F` → 30~60초 관찰.
- **기대**: `[daemon] kiosk heartbeat lost → restarting via schtasks` 로그, 키오스크가 **자동 로그인 사용자 데스크톱에 다시 보임**(Session 0 가 아니라). 30초 유예 후에도 안 오면 재시도. (재기동 전 `taskkill /F /T /IM` 로 좀비/중복 reap)
- **실패 의미**: Session 0/1 다리(schtasks) 문제 또는 작업 미등록.

### 🟡 P2 — 복원력

#### T7. 오프라인 생존
- **절차**: 네트워크 어댑터 비활성화 → 서비스 재시작/관찰.
- **기대**: 박스가 캐시된 daemon 으로 계속 동작, 로그에 `manifest check skipped (offline?)`, **크래시·루프 없음**. 재연결 시 다음 폴링에서 업데이트 재개.

#### T8. NSSM/SCM 자동 재시작
- **절차**: (a) supervisor 의 `bun.exe`(bootstrap) PID 를 `taskkill /F` → NSSM 이 재시작하는지. (b) Windows 재부팅 → 서비스 자동 시작하는지. (c) (가능하면) nssm.exe 프로세스 죽여 `sc failure` 동작 확인.
- **기대**: 모두 자동 복구. 서비스 `RUNNING` 으로 돌아옴.

#### T9. 고아 프로세스 정리
- **절차**: `nssm stop KioskSupervisor` → `Get-Process bun` 확인.
- **기대**: bootstrap/loader/daemon 의 `bun.exe` 자식들이 **전부 종료**(고아 없음). (NSSM 트리 종료 + 우리 SIGINT/SIGTERM 핸들러)

#### T10. 가동 중 wedge 감지
- **목표**: 살아있지만 heartbeat 가 끊긴 daemon 을 loader 가 죽이고 재기동하는가.
- **절차**: 한동안 heartbeat 보내다 멈추는 daemon.js 게시(테스트용), 또는 daemon 에 의도적 deadlock 주입.
- **기대**: 30초 후 `wedged` 판정 → kill → 재기동(신버전이면 롤백).

#### T11. 멱등 재설치
- **절차**: 이미 설치된 박스에서 `install.ps1` 재실행.
- **기대**: stop → 교체 → start 깨끗이. 한글 메시지 정상 출력(UTF-8 BOM 적용됨).

---

## 4. ⚠️ 알려진 리스크 — 반드시 확인할 것

### R1. stdout 버퍼링 → 거짓 재기동 루프 (잠재 버그, 미확인)
heartbeat 는 자식 stdout `@@HB@@` 라인으로 흐른다. 만약 Bun 의 stdout 이 **파이프로 연결될 때 블록 버퍼링**되면, 5초 주기 heartbeat 가 부모에 제때 안 닿아 **부모의 30초 워치독이 오발동 → 자식을 죽이고 재기동하는 루프**가 생길 수 있다.

- **현재 정황**: 설치 직후 로그에 `start v0.2.0` 단 한 줄. 정상이면(버퍼링 없으면) 키오스크 미설치 상태라 30초 후 "kiosk heartbeat lost" 가 쌓여야 하는데 안 보임 → **버퍼링 지연인지, 워치독 오작동인지 미확인.**
- **확인 방법**: 박스를 5~10분 둔 뒤
  - `Get-Process bun` 의 PID·시작시각이 **안정적인지**(주기적으로 바뀌면 재기동 루프 = 버그).
  - `supervisor.log` 에 `start vX` 가 **반복 출력되는지**(반복되면 재기동 루프).
- **만약 버그라면 수정**: heartbeat 송신을 즉시 flush. `console.log` 대신 동기 flush 쓰기(예: `Bun.write(Bun.stdout, line)` 후 flush, 또는 stdout 라인버퍼 강제). 부모 `pumpStdout` 는 청크 단위라 이미 즉시 읽으므로, 송신측 flush 가 관건.

### R2. 키오스크 미설치 박스의 schtasks 노이즈
키오스크 앱이 없는 박스(예: 개발 머신)에서는 daemon 이 30초마다 `schtasks /run Kiosk`(없는 작업) 시도 → 조용히 실패하지만 로그가 쌓인다. 정상 동작이며, 키오스크 설치 후 사라진다.

### R3. IAM 권한
릴리스 시 `s3:PutObject`(+ 버전 산정용 `s3:ListBucket`)가 `kiosk-supervisor/*` 프리픽스에 있어야 함. 박스 다운로드는 **버킷 정책으로 공개 읽기**(파일당 ACL 아님)로 확인됨.

---

## 5. "정상 작동 보장" 체크리스트

배포 승인 전 최소 통과 항목: **T1, T2, T3, T4(+T4b), T5, T6, T7, T8, T9, R1**.
(T10, T11 권장.) 전부 통과하면 "S3 push → 전 박스 안전 자동 갱신 + 키오스크 상시 가동"이 보장된다.
