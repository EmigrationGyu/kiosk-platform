import path from 'node:path';
import {
  PROCESS_ARCH,
  type ProcessArch,
  RUNTIME_BUNDLES,
  runtimeSegments,
} from 'kiosk-types';
import { KIOSK_HOME_DIR } from 'src/constant/LogPaths';

/** 번들로 공급되는 아키텍처 — HOST 는 호스트 런타임을 그대로 쓰므로 받을 것이 없다. */
export type BundledArch = Exclude<ProcessArch, typeof PROCESS_ARCH.HOST>;

export const isBundledArch = (arch: ProcessArch): arch is BundledArch =>
  arch !== PROCESS_ARCH.HOST;

/**
 * 아키텍처 → 그 런타임이 설치되는 디렉토리.
 *
 * **런타임은 디바이스가 아니라 아키텍처에 속한다** — 32비트 기기가 둘이 되어도 여기
 * 하나를 공유한다. 그래서 경로에 디바이스 이름이 들어가지 않는다.
 */
export const runtimeDir = (arch: BundledArch): string =>
  path.join(KIOSK_HOME_DIR, ...runtimeSegments(arch));

/**
 * 아키텍처 → 그 런타임의 실행파일 절대경로.
 *
 * **"어느 경로의 무엇"을 아는 유일한 곳**이다. 위(선언)는 `PROCESS_ARCH` 만 말하고,
 * 아래(운반·실행)는 받은 경로를 그대로 fork 할 뿐 32비트라는 사실을 모른다.
 * 프로비저닝(`RuntimeAssetService`)도 여기서 경로를 받아 쓴다 — 깔아주는 쪽과 띄우는
 * 쪽이 다른 자리를 보면 "받아놨는데 못 찾는" 상태가 생긴다.
 *
 * 판정과 경로가 여기(백엔드)에 있는 것은 의도다 — 백엔드는 부분 업데이트로 갈리지만
 * electron 메인은 전체 재설치를 요구한다. 앞으로 만질 것(새 아키텍처·런타임 교체)은
 * 전부 갈릴 수 있는 쪽에 남아야 한다.
 *
 * `HOST` 는 호스트 런타임을 그대로 쓰므로 실행파일을 따로 갖지 않는다 → `null`.
 */
export function runtimeExecPath(arch: ProcessArch): string | null {
  if (!isBundledArch(arch)) return null;
  return path.join(runtimeDir(arch), RUNTIME_BUNDLES[arch].keyFile);
}
