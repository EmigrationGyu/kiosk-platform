import { platform } from '@platform/Platform';
import { KIOSK_UPDATE_DIR } from 'src/constant/LogPaths';
import { LogService } from 'src/service/LogService';
import { createArtifactFetcher } from './artifactFetcher';
import { extractArchive } from './extract';
import { hasGeneration } from './generationPath';
import { COMPONENT_PUBLIC_KEYS, createSignatureVerifier } from './signing';

/**
 * 산출물을 받아올 곳 — 빌드 시 박힌다(`ARTIFACT_BASE_URL`).
 *
 * **서버가 정하게 두지 않는다.** 매니페스트에 실어 오면 유연해 보이지만, 어디서 받을지는
 * 우리가 정할 일이지 지시하는 쪽이 정할 일이 아니다. 개발에서는 env 로 덮어 로컬 HTTP
 * 서버를 세울 수 있다.
 */
const ARTIFACT_BASE_URL = process.env.ARTIFACT_BASE_URL ?? '';

const verify = createSignatureVerifier(COMPONENT_PUBLIC_KEYS);

export const artifactFetcher = createArtifactFetcher({
  artifactRoot: platform.paths.baseline,
  baseRoot: KIOSK_UPDATE_DIR,
  baseUrl: ARTIFACT_BASE_URL,
  hasGeneration: (component, generation) =>
    hasGeneration(platform.paths.baseline, component, generation),
  extract: extractArchive,
  verify,
  fetch,
  onLog: (message: string) =>
    LogService.getInstance().writeLog({
      level: 'info',
      msg: `[업데이트] ${message}`,
    }),
});
