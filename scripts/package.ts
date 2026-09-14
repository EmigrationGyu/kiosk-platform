#!/usr/bin/env bun
/**
 * 로컬 electron package — 서브레포 빌드 → dist 취합 → electron-forge package
 * (설치 파일 없이 패키징된 앱만; out/). 공통 파이프라인은 ./electron-build 에 있다.
 * make.ts 와 마지막 단계만 다르다.
 *
 *   bun run package               # prod
 *   bun run package --dev         # dev (package:dev)
 *   bun run package --skip-build  # 기존 dist 만 취합 + package
 */
import { runElectronPipeline } from './electron-build';

await runElectronPipeline('package');
