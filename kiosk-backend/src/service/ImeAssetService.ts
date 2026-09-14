import {
  IME_ASSET_BUNDLES,
  IME_ASSET_CDN_PREFIX,
  IME_ASSET_STATUS,
  type ImeAssetBundle,
  type ImeAssetStatus,
  type ImeEnsureAssetsResult,
} from '../constant/events/Ime';
import { RUNTIME_DOWNLOAD_TIMEOUT_MS } from '../constant/timeouts';
import {
  type BundleSpec,
  isProvisioned,
  joinProvision,
} from './assetProvisioner';
import { LogService } from './LogService';

/** IME 번들 → 공용 프로비저너 스펙. 지문이 없는 것이 런타임·디바이스 자산과의 차이다. */
const specOf = (bundle: ImeAssetBundle): BundleSpec => ({
  url: `${IME_ASSET_CDN_PREFIX}${bundle.archive}`,
  archive: bundle.archive,
  segments: [bundle.dirName],
  keyFile: bundle.keyFile,
  timeoutMs: RUNTIME_DOWNLOAD_TIMEOUT_MS,
});

/**
 * IME 자산(rime/mozc 번들) ensure — "없으면 받기"만 한다(버전 비교/갱신 없음).
 * 응답은 존재확인+킥의 즉답이라 호출자(부팅 tolerant 위상)를 네트워크에 붙잡지 않는다.
 * 다운로드 실패는 로그만 남기고 다음 부팅의 ensure 재호출이 곧 재시도다.
 * 자산 갱신이 필요해지면: 새 archive 파일명 업로드 + types 상수 교체(앱 릴리즈 편승).
 *
 * 받아오는 절차 자체는 `assetProvisioner` 공용 코어가 한다 — 런타임·디바이스 자산과
 * 같은 불변식(목적지엔 완전체 아니면 부재)을 공유한다.
 */
export class ImeAssetService {
  private logger = LogService.getInstance();

  ensure(): ImeEnsureAssetsResult {
    return {
      [IME_ASSET_BUNDLES.RIME.dirName]: this.ensureBundle(
        IME_ASSET_BUNDLES.RIME,
      ),
      [IME_ASSET_BUNDLES.MOZC.dirName]: this.ensureBundle(
        IME_ASSET_BUNDLES.MOZC,
      ),
    };
  }

  private ensureBundle(bundle: ImeAssetBundle): ImeAssetStatus {
    const spec = specOf(bundle);
    // 존재 판별은 디렉토리 유무만 — 마커(.bundle)는 escape hatch 용 장부일 뿐 게이트가
    // 아니다(dev 의 수동 배치 자산도 그대로 존중).
    if (isProvisioned(spec)) return IME_ASSET_STATUS.READY;
    joinProvision(spec, (error) =>
      this.logger.error(
        `[ImeAsset] ${bundle.archive} 프로비저닝 실패 (다음 부팅에 재시도)`,
        error,
      ),
    );
    return IME_ASSET_STATUS.PROVISIONING;
  }
}
