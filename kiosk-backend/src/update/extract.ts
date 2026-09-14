import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * tar.gz 를 디렉토리에 푼다.
 *
 * Windows 10 1803+ 는 `tar` 를 내장한다(bsdtar) — 압축 해제만 하자고 의존성을 늘리지
 * 않는다. 다른 호스트로 옮길 때 이 파일만 갈아끼우면 된다.
 *
 * **드라이브 문자를 인자에 넣지 않는다.** 개발 머신은 PATH 앞에 Git 의 GNU tar 가 있는데,
 * 그것은 `C:\path` 를 원격 호스트(`host:path`)로 읽어 "Cannot connect to C" 로 죽는다
 * (실측). cwd 를 옮기고 이름만 넘기면 두 구현 모두에서 돈다.
 *
 * **동기여야 한다.** 비동기로 두면 핸들이 열린 채 rename 이 돌아 Windows 가 EPERM 을
 * 던진다(실측).
 */
export function extractArchive(archivePath: string, destDir: string): void {
  const cwd = path.dirname(archivePath);
  const result = spawnSync(
    'tar',
    ['-xzf', path.basename(archivePath), '-C', path.relative(cwd, destDir)],
    { cwd, encoding: 'utf-8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `tar 실패(status=${result.status}): ${result.stderr?.trim() ?? ''}`,
    );
  }
}
