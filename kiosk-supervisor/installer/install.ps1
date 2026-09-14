# Kiosk Supervisor — Install Script
# 자가 elevation 후 NSSM 으로 Windows Service 등록.
# Idempotent: 재실행 시 기존 서비스 stop → 교체 → start. 신규/재설치 동일 스크립트.
#
# 오프라인 설치: 필요한 모든 파일이 이 폴더(ZIP) 안에 있어야 함 — 네트워크 접근 0.
# 키오스크 자동시작 작업(Kiosk)은 여기서 등록하지 않는다. supervisor daemon 이
# 런타임에 키오스크 heartbeat 의 launch 정보로 등록·보수한다(daemon/kiosk-task.ts).

$ErrorActionPreference = "Stop"

# ─── 자가 elevation ─────────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("Administrators")) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    exit
}

# ─── 설정 (src/constants.ts 의 SERVICE_NAME / INSTALL_DIR 과 일치해야 함) ──
$ServiceName = "KioskSupervisor"
$Dest        = "C:\Program Files\Kiosk\Supervisor"
$Src         = $PSScriptRoot

try {
    # ─── 1) 기존 서비스가 있으면 중지 + 등록 해제 (재설치 케이스) ──
    #     ZIP 동봉 nssm.exe 로 제어 — 첫 설치 땐 $Dest 에 아직 없으므로.
    if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
        Write-Host "기존 서비스 중지/해제 중..."
        & "$Src\nssm.exe" stop   $ServiceName
        & "$Src\nssm.exe" remove $ServiceName confirm
    }

    # ─── 2) 파일 복사 (전부 ZIP 동봉, 다운로드 없음) ────────────────
    Write-Host "파일 복사 중: $Dest"
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    Copy-Item "$Src\bun.exe"      $Dest -Force   # 동결 런타임 앵커
    Copy-Item "$Src\bootstrap.js" $Dest -Force   # 동결 부트스트랩 (NSSM 이 실행)
    Copy-Item "$Src\loader.js"    $Dest -Force   # 로더 (bootstrap 이 감시, S3 갱신)
    Copy-Item "$Src\daemon.js"    $Dest -Force   # 데몬 (loader 가 감시, S3 갱신)
    Copy-Item "$Src\nssm.exe"     $Dest -Force   # 서비스 래퍼
    # 선택 파일 — 빌드/서명 파이프라인이 만들면 동봉. 현재는 enableUpdate=false 라
    # 번들 .sig 를 쓰지 않음(다운로드 시에만 검증). 프로덕션 빌드는 포함할 것.
    foreach ($opt in @("loader.js.sig", "daemon.js.sig", "loader.js.version", "daemon.js.version")) {
        if (Test-Path "$Src\$opt") { Copy-Item "$Src\$opt" $Dest -Force }
    }

    # ─── 3) NSSM 으로 서비스 등록 (LocalSystem 기본, 자동시작) ──────
    #     서비스 = `bun.exe bootstrap.js` (cwd = AppDirectory 라 상대경로로 충분)
    #     bootstrap → loader → daemon 3계층은 런타임에 스스로 연결됨.
    Write-Host "서비스 등록 중: $ServiceName"
    & "$Dest\nssm.exe" install $ServiceName "$Dest\bun.exe"
    & "$Dest\nssm.exe" set $ServiceName AppParameters  bootstrap.js
    & "$Dest\nssm.exe" set $ServiceName AppDirectory   "$Dest"
    & "$Dest\nssm.exe" set $ServiceName Start          SERVICE_AUTO_START
    & "$Dest\nssm.exe" set $ServiceName AppStdout      "$Dest\supervisor.log"
    & "$Dest\nssm.exe" set $ServiceName AppStderr      "$Dest\supervisor.log"
    & "$Dest\nssm.exe" set $ServiceName AppRotateFiles 1
    & "$Dest\nssm.exe" set $ServiceName AppRotateBytes 10485760   # 10MB

    # ─── 4) 크래시 복구 (2계층) ─────────────────────────────────────
    # NSSM: supervisor.exe 가 종료되면 재시작 (기본값이지만 명시).
    & "$Dest\nssm.exe" set $ServiceName AppExit Default Restart
    & "$Dest\nssm.exe" set $ServiceName AppRestartDelay 2000   # 재시작 전 2초
    & "$Dest\nssm.exe" set $ServiceName AppThrottle     1500   # 1.5초 내 종료 = 크래시루프
    # SCM: nssm.exe(서비스 프로세스) 자체가 죽으면 SCM 이 서비스 재시작.
    sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

    # ─── 5) 일본어 IME(mozc) 서버 경로 레지스트리 ───────────────────
    # mozc broker 는 서버 위치를 TIP CLSID InprocServer32 값의 디렉토리에서 해소한다
    # (미등록 시 Program Files (x86)\Mozc 폴백 — 키오스크는 MSI 를 설치하지 않으므로 필수).
    # 경로 참조일 뿐 TSF 카테고리 등록이 아니라 OS IME 목록에는 나타나지 않는다.
    # 자산(ensure 가 받는 mozc 번들)이 아직 없어도 무해 — broker 실행 시점에만 읽힌다.
    # 키오스크 단일 계정 전제: 자가 elevation = 같은 계정의 관리자 토큰이라 USERPROFILE 유효.
    $MozcTipDll   = Join-Path $env:USERPROFILE "Kiosk\mozc\mozc_tip64.dll"
    $MozcClsidKey = "HKLM:\SOFTWARE\Classes\CLSID\{10A67BC8-22FA-4A59-90DC-2546652C56BF}\InprocServer32"
    Write-Host "mozc 서버 경로 레지스트리 등록: $MozcTipDll"
    New-Item -Path $MozcClsidKey -Force | Out-Null
    Set-ItemProperty -Path $MozcClsidKey -Name "(default)" -Value $MozcTipDll

    # ─── 6) 서비스 시작 ─────────────────────────────────────────────
    Write-Host "서비스 시작 중..."
    & "$Dest\nssm.exe" start $ServiceName

    Write-Host ""
    Write-Host "설치 완료." -ForegroundColor Green
    sc.exe query $ServiceName
}
catch {
    Write-Host ""
    Write-Host "설치 실패: $_" -ForegroundColor Red
}
finally {
    Read-Host "Enter 키를 누르세요"
}
