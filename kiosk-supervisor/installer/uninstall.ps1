# Kiosk Supervisor — Uninstall Script
# 자가 elevation 후 서비스 제거 + 키오스크 작업 제거 + 파일 정리.
#
# 키오스크 작업(Kiosk)은 supervisor daemon(SYSTEM)이 소유·생성하므로
# (ensureKioskTask) 여기서 함께 제거한다. daemon 이 없어지면 그 작업도 무의미하다.

$ErrorActionPreference = "Continue"

# ─── 자가 elevation ─────────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("Administrators")) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    exit
}

$ServiceName = "KioskSupervisor"
$Dest        = "C:\Program Files\Kiosk\Supervisor"

# ─── 1) 서비스 중지 + 등록 해제 ─────────────────────────────────
if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "서비스 제거 중: $ServiceName"
    if (Test-Path "$Dest\nssm.exe") {
        & "$Dest\nssm.exe" stop   $ServiceName
        & "$Dest\nssm.exe" remove $ServiceName confirm
    } else {
        # nssm.exe 가 없으면 SCM 직접 — 등록은 됐는데 파일이 지워진 케이스 방어.
        sc.exe stop   $ServiceName | Out-Null
        sc.exe delete $ServiceName | Out-Null
    }
}

# ─── 2) 키오스크 자동시작 작업 제거 ─────────────────────────────
# daemon(SYSTEM)이 만든 작업이라 elevation 된 이 스크립트에서 제거 가능.
$KioskTask = "Kiosk"
if (Get-ScheduledTask -TaskName $KioskTask -ErrorAction SilentlyContinue) {
    Write-Host "키오스크 작업 제거 중: $KioskTask"
    Unregister-ScheduledTask -TaskName $KioskTask -Confirm:$false
}

# ─── 3) 파일 삭제 ───────────────────────────────────────────────
if (Test-Path $Dest) {
    Write-Host "파일 삭제 중: $Dest"
    Remove-Item -Recurse -Force $Dest
}

# ─── 4) 일본어 IME(mozc) 서버 경로 레지스트리 제거 ──────────────
# install.ps1 §5 의 대칭. 값이 Kiosk 경로를 가리킬 때만 지운다 —
# 실제 Mozc MSI 가 설치된 머신(dev 등)의 정규 등록을 건드리지 않기 위함.
$MozcClsidKey = "HKLM:\SOFTWARE\Classes\CLSID\{10A67BC8-22FA-4A59-90DC-2546652C56BF}\InprocServer32"
if (Test-Path $MozcClsidKey) {
    $current = (Get-ItemProperty -Path $MozcClsidKey)."(default)"
    if ($current -like "*Kiosk*") {
        Write-Host "mozc 레지스트리 제거 중: $current"
        Remove-Item -Path (Split-Path $MozcClsidKey -Parent) -Recurse -Force
    }
}

Write-Host ""
Write-Host "제거 완료." -ForegroundColor Green
Read-Host "Enter 키를 누르세요"
