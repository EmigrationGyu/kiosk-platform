import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 일부 네이티브/동적 모듈은 asar 내부가 아니라 resources(extraResource) 쪽에 배치된
 * 코드에서 로드해야 한다(serialport 네이티브 바인딩 · koffi + 로컬 SDK DLL).
 * 그래서 필요한 node_modules 를 target 폴더로 미리 복사한다.
 */

/**
 * koffi 가 실제로 로드할 수 있는 prebuild — 이 키오스크는 Windows 전용이다. 패키지는 18개
 * 플랫폼 prebuild(74MB)를 전부 들고 오지만 런타임에 고르는 건 하나뿐이고, 그 74MB 가
 * KOFFI_SUBPROCESSES 수만큼 곱해져 설치본에 실린다. ia32 = 32비트 DLL 을 여는 쪽(tmr).
 */
const KOFFI_TRIPLETS: readonly string[] = ['win32_x64', 'win32_ia32'];

/**
 * 소스 빌드용 자재 — prebuild 가 있으면 런타임에 열리지 않는다. koffi 의 `install` 스크립트만
 * 쓰는 것들인데 그 스크립트는 target 사본에서 돌지 않고, 런타임 진입점 `index.js` 는 필요한
 * 것을 전부 자기 안에 인라인해 들고 있어 디스크의 `src/`·`vendor/` 를 읽지 않는다.
 */
const KOFFI_BUILD_ONLY_DIRS: readonly string[] = ['src', 'vendor'];

/**
 * 안 쓰는 것을 복사 단계에 잘라내는 cpSync 필터. 잘라낼 곳을 이름으로 한정한다 — koffi 로더는
 * `build/koffi/<triplet>/koffi.node` 를 직접 require 하므로 남긴 triplet 의 경로 모양은 유지된다.
 */
function koffiCopyFilter(srcRoot: string): (src: string) => boolean {
  const prebuildRoot = path.join(srcRoot, 'build', 'koffi');

  return (src: string): boolean => {
    const fromRoot = path.relative(srcRoot, src);
    if (KOFFI_BUILD_ONLY_DIRS.includes(fromRoot.split(path.sep)[0])) {
      return false;
    }

    const fromPrebuild = path.relative(prebuildRoot, src);
    // prebuild 루트 자신이거나 그 바깥이면 판단 대상이 아니다.
    if (
      fromPrebuild === '' ||
      fromPrebuild.startsWith('..') ||
      path.isAbsolute(fromPrebuild)
    ) {
      return true;
    }
    return KOFFI_TRIPLETS.includes(fromPrebuild.split(path.sep)[0]);
  };
}

type CopyPackageOptions = {
  /** node_modules 기준 패키지 경로(e.g. "debug", "@makeomatic/ffi-napi") */
  packages: string[];
  /** 복사 대상의 node_modules 디렉토리 (e.g. target/backend/node_modules) */
  targetNodeModulesDir: string;
  /** 로그 식별자 */
  label: string;
};

function copyPackagesToNodeModules(opts: CopyPackageOptions) {
  const { packages, targetNodeModulesDir, label } = opts;

  fs.mkdirSync(targetNodeModulesDir, { recursive: true });

  for (const pkg of packages) {
    const srcDir = path.join(__dirname, 'node_modules', pkg);
    const destDir = path.join(targetNodeModulesDir, pkg);

    if (!fs.existsSync(srcDir)) {
      console.warn(`[${label}] Warning: ${pkg} not found in node_modules`);
      continue;
    }

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }

    // koffi 만 예외 — 안 쓰는 플랫폼 prebuild·소스 빌드 자재를 잘라낸다(사본마다 80MB).
    const filter = pkg === 'koffi' ? koffiCopyFilter(srcDir) : undefined;
    fs.cpSync(srcDir, destDir, { recursive: true, filter });
    console.log(
      `[${label}] Copied ${pkg} -> ${path.relative(__dirname, destDir)}`,
    );
  }
}

// Serialport packages for receipt printer utility process
const SERIALPORT_PACKAGES = [
  'serialport',
  '@serialport/bindings-cpp',
  '@serialport/bindings-interface',
  '@serialport/binding-mock',
  '@serialport/stream',
  // All parsers (serialport re-exports these)
  '@serialport/parser-byte-length',
  '@serialport/parser-cctalk',
  '@serialport/parser-delimiter',
  '@serialport/parser-inter-byte-timeout',
  '@serialport/parser-packet-length',
  '@serialport/parser-readline',
  '@serialport/parser-ready',
  '@serialport/parser-regex',
  '@serialport/parser-slip-encoder',
  '@serialport/parser-spacepacket',
  'debug',
  'ms',
  'node-addon-api',
  'node-gyp-build',
];

// koffi(네이티브 FFI)를 쓰는 서브프로세스에 넣어줄 런타임 패키지 — 네이티브 바인딩이라
// 번들에 external 이고, 각 서브프로세스의 node_modules 에서 require() 로 해소돼야 한다.
const KOFFI_PACKAGES = ['koffi', 'debug', 'ms'];

// koffi 를 쓰는 serialport 서브프로세스 — suprema(신분증 SDK) · ime(rime.dll) · tmr(CardEncoder.dll).
// 새 FFI 서브프로세스 추가 시 여기에 등록. tmr 은 32비트 런타임으로 뜨지만 복사는 그대로다 —
// 사본이 KOFFI_TRIPLETS(win32_ia32 포함)를 들고 있고 런타임에 자기 것을 고른다.
const KOFFI_SUBPROCESSES = ['suprema', 'ime', 'tmr'];

function copySerialportModules() {
  const targetNodeModulesDir = path.join(__dirname, 'serialport-modules');
  if (fs.existsSync(targetNodeModulesDir)) {
    fs.rmSync(targetNodeModulesDir, { recursive: true });
  }
  copyPackagesToNodeModules({
    packages: SERIALPORT_PACKAGES,
    targetNodeModulesDir,
    label: 'serialport',
  });
}

function copyFfiNapiToTarget() {
  // 번들 external 인 koffi 는 런타임에 dist/index.js 옆 node_modules 에서 require() 로
  // 해소돼야 한다 — 그래서 서브프로세스별로 복사해 넣는다.
  for (const sub of KOFFI_SUBPROCESSES) {
    copyPackagesToNodeModules({
      packages: KOFFI_PACKAGES,
      targetNodeModulesDir: path.join(
        __dirname,
        'target',
        'serialport',
        sub,
        'node_modules',
      ),
      label: `${sub}-ffi (koffi)`,
    });
  }
}

// 자식 프로세스가 동적으로 import 하는 모듈이라 target 에 있어야 한다.
function copySupremaModulesToTarget() {
  const sourceDir = path.join(
    __dirname,
    '..',
    'kiosk-backend',
    'src',
    'suprema',
    'supremaModules',
  );
  const targetDir = path.join(
    __dirname,
    'target',
    'backend',
    'src',
    'suprema',
    'supremaModules',
  );

  if (!fs.existsSync(sourceDir)) {
    console.warn('Warning: supremaModules not found in backend source');
    return;
  }

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true });
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log('Copied supremaModules to target/backend');
}

function copyUtilityBootstrapToTarget() {
  const source = path.join(__dirname, 'scripts', 'utility-bootstrap.js');
  const targetDir = path.join(__dirname, 'target');
  const dest = path.join(targetDir, 'utility-bootstrap.js');

  if (!fs.existsSync(source)) {
    console.warn(
      'Warning: scripts/utility-bootstrap.js not found, skipping copy',
    );
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.cpSync(source, dest, { recursive: false });
  console.log('Copied utility-bootstrap.js to target');
}

// Copy modules before packaging starts
copySerialportModules();
copyFfiNapiToTarget();
copySupremaModulesToTarget();
copyUtilityBootstrapToTarget();

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // 앱 아이콘은 두지 않는다 — 브랜드 자산이라 공개 레포에서 걷어냈고, 없으면
    // Electron 기본 아이콘이 쓰인다. 실제 배포에서는 여기에 .ico 를 지정한다.
    extraResource: ['./target', './serialport-modules'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'kiosk_electron',
      setupExe: 'Kiosk-Setup.exe',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      // 렌더러 2차 패스 없음 — 프론트엔드는 이미 완성된 번들이고, main.ts 가
      // resources/target/frontend 를 직접 로드한다(원격 부분 업데이트 대상).
      renderer: [],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
