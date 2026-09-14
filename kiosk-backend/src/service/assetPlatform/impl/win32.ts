// IME 자산 ensure 의 Windows 종속 조각 — 리눅스 포팅 시 이 파일의 대응물만 만들면 되는 얇은 면.
import path from 'node:path';

/**
 * tar.gz 해제 커맨드(argv 배열).
 * PATH 의 tar 는 Git 동봉 GNU tar 일 수 있고, 그건 `C:\...` 를 원격 호스트로 해석한다 —
 * Windows 내장 bsdtar(Win10 1803+)를 절대경로로 고정한다. (조립 스크립트와 같은 도구)
 */
export const tarExtractCommand = (
  archivePath: string,
  destDir: string,
): [string, ...string[]] => [
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
  '-xzf',
  archivePath,
  '-C',
  destDir,
];
