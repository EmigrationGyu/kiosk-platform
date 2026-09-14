#!/usr/bin/env bun
/**
 * 로컬 electron make — 서브레포 빌드 → dist 취합 → electron-forge make (설치 파일/배포물).
 * 공통 파이프라인은 ./electron-build 에 있다. package.ts 와 마지막 단계만 다르다.
 *
 *   bun run make               # prod
 *   bun run make --dev         # dev (make:dev)
 *   bun run make --skip-build  # 기존 dist 만 취합 + make
 */
import { runElectronPipeline } from './electron-build';

await runElectronPipeline('make');
