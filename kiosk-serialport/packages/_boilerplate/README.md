# Serial Device Boilerplate

시리얼 포트 기반 하드웨어 디바이스 패키지를 새로 추가할 때 사용하는 보일러플레이트입니다.

## 사용법

1. `_boilerplate` 폴더를 복사하여 `packages/` 아래에 새 디바이스 이름으로 붙여넣기
2. 아래 체크리스트를 따라 플레이스홀더를 실제 값으로 교체

## 커스터마이즈 체크리스트

### 1. `package.json`
- [ ] `name`을 실제 디바이스 패키지 이름으로 변경

### 2. `src/constants/endpoints.ts`
- [ ] `ENDPOINTS`의 경로에서 `your_device`를 실제 디바이스 이름으로 변경
- [ ] `DeviceSchemas`, `DeviceRequestMap`, `DeviceResponseMap` 이름을 디바이스에 맞게 변경
- [ ] 디바이스에 필요한 엔드포인트 추가

### 3. `src/router/DeviceRouter.ts`
- [ ] 클래스명 변경
- [ ] `DEVICE_PIPE_PATH`를 `\\.\pipe\kiosk-{디바이스명}` 형식으로 변경

### 4. `src/controller/DeviceController.ts`
- [ ] 클래스명 변경
- [ ] 추가된 엔드포인트에 대한 핸들러 구현

### 5. `src/strategy/deviceStrategies.ts`
- [ ] `healthCheckStrategy`의 바이트 시퀀스를 실제 디바이스 프로토콜에 맞게 변경
- [ ] 디바이스별 커맨드 전략(encode/decode) 추가

### 6. `src/service/SerialPortService.ts`
- [ ] 헬스체크 응답 검증 조건(`sendAndAwait`의 두 번째 인자) 수정
- [ ] 추가 커맨드에 대한 메서드 구현

### 7. `src/app.ts`
- [ ] 변경된 Router/Controller 클래스명에 맞게 import 수정

### 8. `index.ts`
- [ ] `Logger.getInstance('your_device')`에 디바이스명 지정
- [ ] 부트 완료 후 `console.log('[ready]')` 호출이 유지되는지 확인 (루트 `bun run dev` 오케스트레이터가 이 신호를 기다림)

### 9. CI/CD — `.github/workflows/release-full.yml` (상위 레포 `kiosk-platform`)
- [ ] **Compute serialport package versions** 스텝의 `for pkg in ... ; do` 목록에 패키지 이름 추가
- [ ] **Build serialport packages** 스텝의 동일 loop에도 추가
- [ ] **Upload all dists to S3** 스텝에 `aws s3 sync "kiosk-serialport/packages/{디바이스}/dist" ...` 한 줄 추가
- [ ] **Commit & push bumps to serialport repo** 스텝의 `git add`, `push_tags` 호출에 `packages/{디바이스}/package.json` / `${{ steps.bump_serialport.outputs.{디바이스}_name }}` 추가
- [ ] `release-electron-only.yml`의 **Find latest versions from S3 and download** 스텝에 `find_latest_version` + `download_package` 호출 추가 후, **Verify and fix target contents structure** 스텝의 `fix_directory_structure` 호출에도 경로 추가
- [ ] S3 bucket에서 새 패키지 prefix로 정상 업로드/다운로드되는지 develop 브랜치에서 확인

### 10. 루트 dev 오케스트레이터 — `scripts/dev.ts`
- [ ] `SERIALPORTS` 배열에 새 디바이스 엔트리 추가:
  ```ts
  {
    name: '{디바이스}',
    color: C.{색상},  // cyan/magenta/yellow 외에서 고르거나 새로 추가
    cwd: 'kiosk-serialport/packages/{디바이스}',
    cmd: 'npm',
    args: ['run', 'start'],
    readyMarker: '[ready]',
  }
  ```
- [ ] `bun run dev`로 실행 시 새 디바이스가 `[디바이스]` 접두로 로그 찍히고 `[ready]` 감지 후 backend로 넘어가는지 확인

## 파일 구조 및 역할

```text
src/
├── app.ts                  # 앱 부트스트랩 (Router + Controller 연결)
├── constants/
│   └── endpoints.ts        # IPC 엔드포인트 정의 및 Zod 스키마
├── controller/
│   └── DeviceController.ts # 요청 핸들러 (엔드포인트 → 서비스 호출)
├── router/
│   └── DeviceRouter.ts     # IPC 라우터 (Named Pipe 수신)
├── service/
│   └── SerialPortService.ts # 시리얼 포트 통신 (연결, 커맨드 송수신)
└── strategy/
    └── deviceStrategies.ts  # 프로토콜별 인코딩/디코딩 전략
```

## 기본 제공 기능

- **포트 연결 (`port-assigned`)**: port-manager로부터 할당받은 시리얼 포트에 연결
- **헬스체크 (`health-check`)**: 디바이스 응답 여부 확인 (타임아웃 3초)

## 새 커맨드 추가 흐름

1. `endpoints.ts`에 엔드포인트 경로, 스키마, 타입 추가
2. `deviceStrategies.ts`에 encode/decode 전략 작성
3. `SerialPortService.ts`에 해당 전략을 사용하는 메서드 추가
4. `DeviceController.ts`에 핸들러 연결
