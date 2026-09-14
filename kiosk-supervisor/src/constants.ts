/** 시스템 상수 — 식별자·경로·인터벌 + 빌드 시 임베드되는 환경값. */

export const SERVICE_NAME = 'KioskSupervisor' as const;
export const KIOSK_TASK_NAME = 'Kiosk' as const;

// 키오스크 설치 위치 — heartbeat 없이 launch 를 복원할 때만 쓴다. Squirrel per-user 설치본은
// KIOSK_INSTALL_DIR_NAME 아래에 Update.exe(버전 불변 stub)와 app-<ver> 페이로드로 놓인다.
// 디렉터리명 = electron forge.config.ts 의 MakerSquirrel `name`.
export const USER_PROFILES_DIR = 'C:\\Users' as const;
export const KIOSK_INSTALL_DIR_NAME = 'kiosk_electron' as const;

// install.ps1 와 일치해야 한다.
export const INSTALL_DIR = 'C:\\Program Files\\Kiosk\\Supervisor' as const;

// INSTALL_DIR 기준 경로 조합 (node:path 대신 — 고정 Windows 절대경로라 단순 결합으로 충분).
export const inDir = (name: string): string => `${INSTALL_DIR}\\${name}`;

// ── 3계층 아티팩트 ──
// bun.exe(동결 런타임) ─ bootstrap.js(동결) ─ loader.js(S3) ─ daemon.js(S3)
// NSSM 은 `bun.exe bootstrap.js` 를 서비스로 올리고, bootstrap 이 `bun.exe loader.js`,
// loader 가 `bun.exe daemon.js` 를 각각 감시/업데이트한다.
export const BUN_FILENAME = 'bun.exe' as const;
export const BOOTSTRAP_FILENAME = 'bootstrap.js' as const;
export const LOADER_FILENAME = 'loader.js' as const;
export const DAEMON_FILENAME = 'daemon.js' as const;

export const BUN_PATH = inDir(BUN_FILENAME);
export const LOADER_PATH = inDir(LOADER_FILENAME);
export const DAEMON_PATH = inDir(DAEMON_FILENAME);
// supervisor-core 가 childPath 로부터 파생: <child>.previous / <child>.version /
// <child>.version.previous / <child>.neg.json — 별도 상수 불필요.

export const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30분 — S3 매니페스트 폴링 주기
export const HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30초 — 자식 시작/가동 중 heartbeat 대기 창
export const SPAWN_BACKOFF_MS = 5 * 1000; // 5초 — 비정상 종료 후 재spawn 지연
export const HEARTBEAT_INTERVAL_MS = 5 * 1000; // 5초 — 자식이 heartbeat 보내는 주기
export const FETCH_TIMEOUT_MS = 10 * 1000; // 10초 — S3 fetch 타임아웃 (오프라인 시 빠르게 포기)

export const KIOSK_HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30초 — 키오스크 heartbeat 끊김 = 죽음 판정
export const KIOSK_RESTART_GRACE_MS = 30 * 1000; // 30초 — schtasks 재기동 후 키오스크 부팅 유예(=지속 실패 시 재시도 간격)

// 경로/값 계약 = kiosk-types 의 `update/components.ts` + `update/applyRecord.ts`.
// supervisor 는 그 패키지를 의존하지 않으므로(홀로 서는 것이 설계다) 값을 미러링한다 —
// 바꾸려면 양쪽을 함께 바꾼다.
//   <프로필>\Kiosk\update\last-apply.json
export const KIOSK_DATA_DIR_NAME = 'Kiosk' as const;
export const KIOSK_UPDATE_DIR_NAME = 'update' as const;
export const KIOSK_APPLY_RECORD_FILE = 'last-apply.json' as const;
/** 이 값에 머물러 있는 기록 = 설치가 끝나지 못했다 (키오스크 스키마의 정의). */
export const KIOSK_APPLY_OUTCOME_INSTALLING = 'installing' as const;

/**
 * 설치 중이라는 선언을 얼마나 믿어줄까. **유한해야 한다** — 설치가 정말 죽으면 기록은
 * `installing` 에 영원히 머무는데, 그걸 무기한 믿으면 워치독이 영영 무장 해제돼 벽돌이 된다.
 *
 * 실측(2026-08-28, 1.25.0 설치 성공분)으로 heartbeat 공백의 상한이 약 21초 — 8배 남짓 잡는다.
 * 유예 중에도 워치독은 KIOSK_RESTART_GRACE_MS 마다 기록을 다시 읽으므로 이 시간을 통째로
 * 기다리는 게 아니다.
 */
export const KIOSK_INSTALL_HOLD_MS = 3 * 60 * 1000; // 3분

// daemon ↔ 키오스크 Electron: named pipe.
export const IPC_PIPE_KIOSK = '\\\\.\\pipe\\kiosk-electron' as const;

// 부모↔자식: 자식이 stdout 에 이 prefix 로 시작하는 한 줄 JSON 을 주기 출력하면 부모가 라인
// 단위로 파싱해 heartbeat 로 인식한다(bootstrap←loader, loader←daemon 동일).
export const HEARTBEAT_LINE_PREFIX = '@@HB@@' as const;

// CI(scripts/release.ts)가 `bun build --define process.env.X=...` 로 주입. 미주입(로컬/테스트)이면
// placeholder 로 폴백. 동결 도메인(CNAME/CloudFront) 권장.
const S3_BASE =
  process.env.SUPERVISOR_S3_BASE ??
  'https://example.s3.ap-northeast-2.amazonaws.com/kiosk-supervisor';
export const LOADER_MANIFEST_URL = `${S3_BASE}/loader/latest.json`;
export const DAEMON_MANIFEST_URL = `${S3_BASE}/daemon/latest.json`;

export const PUBLIC_KEYS: readonly string[] = [
  `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8Rr75T+8Hg/gxCvxWP2T
sQ7xOamDkcGGTRJSyBJcic3h8fZBkil9PYPKpiaqU9h74TxQPoslN+OFQqmExR8R
laJKAoavaMzfLW12IYB61vjuuVGq9SZZDVlPsULRJrnDoQPNX3wnjPkLKMDwf/bq
hN41JnaMDKMj/4LM2im++9X4raRotDzk5uAAijNuAypE+fATEQ7EI0LQaILEuzSH
Mc6CQREZMvN/1ij+iNX8OK93pkO9gAdLSmhAeGCgNHn1ocZrMkZ/v/H34ikQrGOR
sppQhg+P5jitTO+0UgWkNCHICbMbKmc0IWvJP3/t8zykotqtgMZUTls3v0qpx2J3
+wIDAQAB
-----END PUBLIC KEY-----`,
];

// 각 계층 자기 버전 — heartbeat 페이로드/로깅용. CI 가 --define 로 주입.
export const LOADER_VERSION = process.env.SUPERVISOR_VERSION ?? '0.0.0-dev';
export const DAEMON_VERSION = process.env.SUPERVISOR_VERSION ?? '0.0.0-dev';
