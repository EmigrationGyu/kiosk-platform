/**
 * 서브프로세스 **실행 런타임** 계약 — 단일 출처.
 *
 * 대부분의 서브프로세스는 호스트(electron utilityProcess / dev node)의 런타임에 그대로 얹힌다.
 * 그러지 못하는 것은 네이티브 의존이 호스트와 **다른 아키텍처**로만 배포되는 경우다 — 국내
 * 도어락·VAN 계열 벤더 DLL 은 지금도 x86 배포가 흔해서 되풀이될 축이다. 그래서 "32비트로 띄운다"를
 * 기기마다 손으로 적는 대신 **프로세스가 자기 아키텍처를 선언**한다:
 *
 *   선언(types) → 해소(backend: 경로) → 운반(bridge: execPath) → 실행(electron: fork)
 *
 * 런타임은 **디바이스가 아니라 아키텍처에 속한다** — 32비트 기기가 둘이 되어도 node.exe 는 하나만
 * 받아 공유하므로 경로에 디바이스 이름이 없다. types 는 환경을 모르므로(브라우저 번들에도 들어간다)
 * 세그먼트만 돌려주고 `path.join` 은 호출부가 한다.
 */
import {
  SERIALPORT_PROCESS,
  type SerialportProcess,
} from '../serialport/processes';

/**
 * 서브프로세스가 요구하는 프로세스 아키텍처.
 *
 * `HOST` = 호스트와 같다(기본). 그 외는 자기 런타임을 들고 와야 한다.
 */
export const PROCESS_ARCH = {
  HOST: 'host',
  IA32: 'ia32',
} as const;

export type ProcessArch = (typeof PROCESS_ARCH)[keyof typeof PROCESS_ARCH];

/** 호스트 런타임에 얹히지 못해 별도 런타임이 필요한 아키텍처인가. */
export const needsOwnRuntime = (arch: ProcessArch): boolean =>
  arch !== PROCESS_ARCH.HOST;

/**
 * 서브프로세스별 요구 아키텍처 — **이 축의 단일 출처.**
 *
 * `satisfies Record<SerialportProcess, …>` 라 **닫힌 집합이다**: 새 디바이스를 만들고 여기 안 적으면
 * 컴파일이 막힌다. 그게 목적이다 — "모르고 빠지는 것"과 "알고 HOST 로 두는 것"이 구별돼야 한다.
 * **`bun gen bs` 가 기본값을 주입하지 않는다** — 자동으로 `HOST` 가 채워지면 그 판단을 아무도 안 하게
 * 된다. 컴파일 에러가 곧 질문이다: 이 디바이스의 네이티브 의존이 호스트 런타임에 얹히는가?
 */
export const PROCESS_ARCH_OF = {
  [SERIALPORT_PROCESS.IME]: PROCESS_ARCH.HOST,
  [SERIALPORT_PROCESS.TOKEN_DISPENSER]: PROCESS_ARCH.HOST,
  [SERIALPORT_PROCESS.OUTBOX]: PROCESS_ARCH.HOST,
} as const satisfies Record<SerialportProcess, ProcessArch>;

/** 이 프로세스가 호스트 런타임에 얹히지 못하는가 — spawn 방식이 갈리는 지점. */
export const isSelfHosted = (process: SerialportProcess): boolean =>
  needsOwnRuntime(PROCESS_ARCH_OF[process]);

/** `~/.kiosk` 아래에서 실행 런타임들이 모여 있는 디렉토리 이름. */
export const RUNTIME_DIR = 'runtime';

/**
 * `~/.kiosk` 기준 상대 경로 세그먼트 — 이 아키텍처의 런타임이 설치되는 자리.
 * `PROCESS_ARCH.HOST` 는 설치할 것이 없으므로 호출부가 먼저 걸러야 한다.
 */
export function runtimeSegments(arch: Exclude<ProcessArch, 'host'>): string[] {
  return [RUNTIME_DIR, `node-${arch}`];
}

// ── 런타임 자산 배포 계약 ──
// IME 자산과 같은 규약: 고정 키 1회 업로드(불변 객체) + "없으면 받기" ensure. 갱신은 덮어쓰기가
// 아니라 **새 archive 파일명 업로드 + 여기 상수 교체**로 앱 릴리즈에 편승한다 — CloudFront 무효화가
// 영원히 불필요하다. 레거시의 `download/node.exe` 를 재사용하지 않는 이유: 버전이 이름에 없어 갱신이
// 곧 덮어쓰기이고, 그 객체를 2.x 키오스크가 이미 쓰고 있으며, 비압축이라 63MB 를 그대로 내려받는다.

/** 런타임 번들이 놓이는 CDN prefix (locales·audios·ime 와 같은 CloudFront). */
export const RUNTIME_ASSET_CDN_PREFIX =
  'https://assets.example.invalid/runtime/v3/';

export const RUNTIME_BUNDLES = {
  [PROCESS_ARCH.IA32]: {
    /** S3 고정 키 파일명(불변 객체 — 갱신 시 새 이름으로). */
    archive: 'node-v22.23.2-win-x86.tar.gz',
    /** 해제 성공 검증용 실행파일(번들 루트 기준). 이것이 곧 fork 의 execPath 다. */
    keyFile: 'node.exe',
    /**
     * archive 의 sha256. **IME 자산과 갈라지는 유일한 지점**이다 — 저쪽은 데이터지만 이건 우리가
     * 실행할 바이너리라 CDN 캐시 오염·부분 전송을 그냥 넘길 수 없다. 조립 스크립트가 이 값을
     * 대조하므로 굽는 쪽과 받는 쪽이 같은 물건을 본다.
     */
    sha256: '1949c7b15c682dfd457d7c149df810517068f5c818344ff2d7e0096130716f97',
  },
} as const satisfies Record<
  Exclude<ProcessArch, 'host'>,
  { archive: string; keyFile: string; sha256: string }
>;

export type RuntimeBundle =
  (typeof RUNTIME_BUNDLES)[keyof typeof RUNTIME_BUNDLES];

/** 번들 존재 판정 결과. 아직 소켓 계약이 아니라 Zod 를 두지 않는다(프리페치 이벤트 때). */
export const RUNTIME_ASSET_STATUS = {
  /** 런타임이 로컬에 있다 — 즉시 fork 할 수 있다. */
  READY: 'ready',
  /** 없다 — 백그라운드 다운로드를 킥했다. 도착하면 다음 요청이 성립한다. */
  PROVISIONING: 'provisioning',
} as const;

export type RuntimeAssetStatus =
  (typeof RUNTIME_ASSET_STATUS)[keyof typeof RUNTIME_ASSET_STATUS];
