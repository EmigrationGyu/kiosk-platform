import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ASSET_MARKER_FILE } from 'kiosk-types';
import { KIOSK_HOME_DIR } from '../constant/LogPaths';
import { tarExtractCommand } from './assetPlatform';

const execFileAsync = promisify(execFile);

/**
 * "없으면 받기" 프로비저닝의 **공용 코어**. IME 자산 · 실행 런타임 · 디바이스 자산 셋이 같은 절차를
 * 쓴다: 다운로드 → (선택) 지문 대조 → 해제 → 핵심 파일 검증 → 마커 → **원자적 rename**.
 *
 * 불변식 하나가 이 모듈의 존재 이유다: **목적지에는 완전체 아니면 부재만 있다.** 중간 상태가 남으면
 * 존재 판정(디렉토리 유무)이 거짓말을 하게 되고 "받아놨는데 안 되는" 상태가 굳는다.
 *
 * 갱신 개념이 없는 것도 의도다 — archive 파일명이 불변 키라, 바꿔야 하면 새 이름을 올리고 상수를
 * 교체해 앱 릴리즈에 편승한다. 그래서 버전 비교가 없다.
 */
export type BundleSpec = {
  /** 받아올 곳(전체 URL). */
  url: string;
  /** archive 파일명 — staging 파일명이자 마커에 남길 장부 값. */
  archive: string;
  /** 설치 위치(`~/.kiosk` 기준 세그먼트). 마지막 세그먼트가 rename 대상이다. */
  segments: string[];
  /** 해제 성공 검증용 핵심 파일(번들 루트 기준). */
  keyFile: string;
  /**
   * 있으면 다운로드 직후 대조하고 어긋나면 폐기한다. 실행되는 바이너리(런타임·벤더 DLL)에는 반드시
   * 둔다 — CDN 캐시 오염·중간 변조를 그냥 넘길 수 없다. 데이터 번들은 생략해도 된다.
   */
  sha256?: string;
  /** 다운로드 상한(ms). 멈춘 CDN 이 작업을 영원히 붙잡지 않게. */
  timeoutMs: number;
};

/** 이 번들이 설치되는 절대 경로. 존재 판정과 소비처가 같은 자리를 봐야 한다. */
export const bundleDir = (spec: BundleSpec): string =>
  path.join(KIOSK_HOME_DIR, ...spec.segments);

/**
 * 설치돼 있는가 — **디렉토리 유무만** 본다. 마커(`.bundle`)는 escape hatch 용 장부일 뿐 게이트가
 * 아니다 — 게이트로 쓰면 개발 중 손으로 배치한 자산이 거부된다.
 */
export const isProvisioned = (spec: BundleSpec): boolean =>
  fs.existsSync(bundleDir(spec));

/**
 * 한 번들을 받아 설치한다. 실패는 그대로 throw — 삼키면 부르는 쪽이 재시도할 근거를 잃는다.
 * staging 은 목적지 옆에 둔다: 같은 볼륨이어야 rename 이 원자적이다(다른 볼륨이면 복사+삭제로 풀려
 * 중간 상태가 보인다).
 */
export async function provisionBundle(spec: BundleSpec): Promise<void> {
  const targetDir = bundleDir(spec);
  const stagingRoot = path.join(KIOSK_HOME_DIR, '.staging');
  const archivePath = path.join(stagingRoot, spec.archive);
  const extractDir = path.join(stagingRoot, `${spec.segments.join('-')}.tmp`);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  const response = await fetch(spec.url, {
    signal: AbortSignal.timeout(spec.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`다운로드 실패 ${spec.url} → ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  if (spec.sha256) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== spec.sha256) {
      throw new Error(
        `지문 불일치 — 기대 ${spec.sha256}, 받은 것 ${digest} (${spec.url})`,
      );
    }
  }
  fs.writeFileSync(archivePath, bytes);

  const [tarBin, ...tarArgs] = tarExtractCommand(archivePath, extractDir);
  await execFileAsync(tarBin, tarArgs);

  if (!fs.existsSync(path.join(extractDir, spec.keyFile))) {
    throw new Error(`해제 검증 실패 — ${spec.keyFile} 없음`);
  }
  fs.writeFileSync(path.join(extractDir, ASSET_MARKER_FILE), spec.archive);

  // 중첩 경로(`runtime/node-ia32` 등)면 부모가 없을 수 있다 — 없으면 rename 이 ENOENT.
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.renameSync(extractDir, targetDir);
  fs.rmSync(archivePath, { force: true });
}

/**
 * 단일비행 레지스트리 — 같은 번들을 두 번 받지 않는다. 서버 상태 캐시가 아니라 프로세스-로컬
 * 동시성 제어다(백엔드 무상태 원칙과 무관). vite-node HMR 이 모듈 static 을 리셋하므로 globalThis 백킹.
 */
const INFLIGHT_KEY = '__ASSET_PROVISION_INFLIGHT__';
const inflight = (): Map<string, Promise<void>> => {
  const registry = globalThis as unknown as Record<
    string,
    Map<string, Promise<void>> | undefined
  >;
  return (registry[INFLIGHT_KEY] ??= new Map());
};

/**
 * 프로비저닝을 시작하거나 **이미 돌고 있으면 그 작업을 돌려준다.** 돌려주는 promise 는 성공·실패를
 * 그대로 전한다 — 즉답형 호출자(프리페치)는 버리고 합류형(spawn)은 기다린다. 한쪽이 삼키면 다른 쪽이
 * 실패를 못 보므로, 아무도 안 받는 경우를 위해 `onError` 로 한 번만 남긴다(unhandled rejection 방지).
 */
export function joinProvision(
  spec: BundleSpec,
  onError: (error: unknown) => void,
): Promise<void> {
  const key = spec.segments.join('/');
  const registry = inflight();
  const running = registry.get(key);
  if (running) return running;

  const job = provisionBundle(spec).finally(() => registry.delete(key));
  registry.set(key, job);
  job.catch(onError);
  return job;
}
