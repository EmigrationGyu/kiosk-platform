import os from 'node:os';
import path from 'node:path';
import { LOCAL_DATA_DIR } from 'kiosk-types';

export type RimePaths = {
  /** rime.dll 절대 경로. */
  dllPath: string;
  /** 스키마/사전(shared) 디렉토리 — 읽기 전용 자산. */
  sharedDataDir: string;
  /** 사용자 데이터(쓰기) — deploy 산출 .bin 이 여기 build/ 로 들어간다. */
  userDataDir: string;
};

// 키오스크 데이터 홈. Logger(~/.kiosk/logs)와 같은 홈에 rime 자산을 둔다.
// 설치 위치와 무관 — rime 는 자족 dll+데이터라 아무 읽기/쓰기 경로면 된다.
// prod 는 S3 → 이 경로로 ensure(다운로드)하고, dev/test 는 env 로 덮어쓸 수 있다.
const DEFAULT_RIME_DIR = path.join(os.homedir(), LOCAL_DATA_DIR, 'rime');

/**
 * rime 자산 경로 해소. 단일 출처 = env `RIME_DATA_PATH`(있으면) 또는 기본 `~/.kiosk/rime`.
 * 레이아웃: `<base>/rime.dll` + 스키마 yaml + opencc/ + `user/`(쓰기, 런타임 생성).
 * 파일이 없으면 상위(RimeEngine.ensureReady)의 존재검증에서 ENGINE_NOT_READY 로 떨어진다.
 *
 * 보안 가정: RIME_DATA_PATH 는 검증 없이 그대로 쓰이므로 이 값을 설정할 수 있으면 임의 rime.dll 을
 * dlopen 할 수 있다. 서명된 키오스크 배포에서 env 는 통제된 신뢰 경계라 의도적으로 허용한다.
 * (덜 신뢰된 컨텍스트로 이식 시 부모 dir 화이트리스트/서명검증/prod-미허용 중 하나를 검토)
 */
export function resolveRimePaths(): RimePaths {
  const base = process.env.RIME_DATA_PATH ?? DEFAULT_RIME_DIR;
  return {
    dllPath: path.join(base, 'rime.dll'),
    sharedDataDir: base,
    userDataDir: path.join(base, 'user'),
  };
}
