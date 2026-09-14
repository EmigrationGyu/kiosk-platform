// IME 번들 조립의 Windows 종속 조각 — 리눅스 포팅 시 이 파일의 대응물만 만들면 되는 얇은 면.
import path from 'node:path';

/**
 * 압축/해제에 쓸 tar 바이너리.
 * PATH 의 tar 는 Git 동봉 GNU tar 일 수 있고, 그건 `C:\...` 를 원격 호스트로 해석한다 —
 * Windows 내장 bsdtar(Win10 1803+)를 절대경로로 고정한다.
 */
export const tarBinary = (): string =>
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

/**
 * mozc MSI administrative 추출(시스템 등록 없음, 관리자 불필요) 커맨드.
 * mozc 번들 자체가 win64 산출물이라 이 조각은 리눅스 대응물이 없다 — 조립은 Windows 에서 한다.
 */
export const msiExtractCommand = (
  msiPath: string,
  targetDir: string,
): string[] => ['msiexec', '/a', msiPath, '/qn', `TARGETDIR=${targetDir}`];
