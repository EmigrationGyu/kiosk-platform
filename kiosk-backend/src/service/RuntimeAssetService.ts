import {
  PROCESS_ARCH_OF,
  type ProcessArch,
  RUNTIME_ASSET_CDN_PREFIX,
  RUNTIME_ASSET_STATUS,
  RUNTIME_BUNDLES,
  type RuntimeAssetStatus,
  runtimeSegments,
  type SerialportProcess,
} from 'kiosk-types';
import { RUNTIME_DOWNLOAD_TIMEOUT_MS } from '../constant/timeouts';
import { isBundledArch } from '../processManager/runtime';
import {
  type BundleSpec,
  isProvisioned,
  joinProvision,
} from './assetProvisioner';
import { LogService } from './LogService';

/**
 * 서브프로세스를 띄우기 전에 갖춰져 있어야 하는 것 — **"없으면 받기"만 한다**(버전 비교·갱신 없음.
 * archive 파일명이 불변 키라 갱신은 앱 릴리즈에 편승한다).
 *
 * 축이 둘이다: **실행 런타임**은 아키텍처에 속하므로 32비트 기기가 둘이 되어도 하나를 공유하고
 * (`runtime/node-<arch>/`), **디바이스 자산**은 그 디바이스만 쓴다(`devices/<process>/`). 소유자가
 * 다르면 자리도 다르다 — 합쳐 두면 두 번째 32비트 기기가 node.exe 를 또 받는다.
 *
 * 응답은 존재확인 + 킥의 즉답이라 호출자를 네트워크에 붙잡지 않는다(런타임이 ~29MB).
 */

/**
 * 디바이스별 벤더 자산. **부분 맵이다** — 자산이 없는 디바이스가 대부분이고, 빠뜨려도 조용히 새지
 * 않는다(그 DLL 을 열려는 순간 실패한다). 아키텍처 선언(`PROCESS_ARCH_OF`)이 전수 Record 인 것과
 * 대비된다: 저쪽은 답을 안 하면 **잘못된 방식으로 뜨기** 때문이다.
 */
const DEVICE_BUNDLES: Partial<Record<SerialportProcess, BundleSpec>> = {};

const runtimeSpec = (arch: ProcessArch): BundleSpec | null => {
  if (!isBundledArch(arch)) return null;
  const bundle = RUNTIME_BUNDLES[arch];
  return {
    url: `${RUNTIME_ASSET_CDN_PREFIX}${bundle.archive}`,
    archive: bundle.archive,
    segments: runtimeSegments(arch),
    keyFile: bundle.keyFile,
    sha256: bundle.sha256,
    timeoutMs: RUNTIME_DOWNLOAD_TIMEOUT_MS,
  };
};

/** 이 프로세스가 떠 있으려면 있어야 하는 번들들. 받을 것이 없으면 빈 배열. */
const specsFor = (process: SerialportProcess): BundleSpec[] => {
  const runtime = runtimeSpec(PROCESS_ARCH_OF[process]);
  const device = DEVICE_BUNDLES[process];
  return [...(runtime ? [runtime] : []), ...(device ? [device] : [])];
};

export class RuntimeAssetService {
  private logger = LogService.getInstance();

  /**
   * 지금 당장 fork 할 수 있는가 — **동기**.
   * spawn 직전 게이트가 쓴다(네트워크를 기다릴 수 없는 자리).
   */
  isReady(process: SerialportProcess): boolean {
    return specsFor(process).every(isProvisioned);
  }

  /**
   * 있으면 READY, 없으면 백그라운드 다운로드를 킥하고 PROVISIONING.
   * 받을 것이 없는 프로세스는 언제나 READY 다.
   */
  ensure(process: SerialportProcess): RuntimeAssetStatus {
    const missing = specsFor(process).filter((spec) => !isProvisioned(spec));
    if (missing.length === 0) return RUNTIME_ASSET_STATUS.READY;
    for (const spec of missing) this.kick(spec);
    return RUNTIME_ASSET_STATUS.PROVISIONING;
  }

  /**
   * 이 프로세스를 띄울 수 있게 될 때까지 — **spawn 이 기다리는 얼굴.**
   *
   * `ensure` 와 같은 단일비행 맵을 보므로 프리페치가 이미 돌고 있었으면 **그 작업에 합류한다.**
   * 띄우려는 행위 자체가 "나 이거 필요해요"의 선언이라 in-flight 인지 따로 묻지 않는다.
   * 실패하면 reject 한다 — 스포너가 로그를 남기고 자기 `ready` 는 풀어줘야 한다.
   */
  whenReady(process: SerialportProcess): Promise<void> {
    const missing = specsFor(process).filter((spec) => !isProvisioned(spec));
    if (missing.length === 0) return Promise.resolve();
    return Promise.all(missing.map((spec) => this.kick(spec))).then(
      () => undefined,
    );
  }

  private kick(spec: BundleSpec): Promise<void> {
    return joinProvision(spec, (error) => {
      this.logger.error('[Asset] 프로비저닝 실패 (다음 요청에 재시도)', error, {
        unmasked: { archive: spec.archive },
      });
    });
  }
}

/**
 * 프로세스 매니저·프리페치가 공유하는 단일 인스턴스. 단일비행 맵이 globalThis 백킹이라 인스턴스가
 * 여럿이어도 합류는 되지만, 소유자가 하나여야 "누가 받고 있나"를 읽을 자리가 하나로 남는다.
 */
export const runtimeAssets = new RuntimeAssetService();
