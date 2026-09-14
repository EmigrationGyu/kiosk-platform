#!/usr/bin/env bun
/**
 * Kiosk 보일러플레이트 생성기 (루트 통합 진입점)
 *
 *   bun gen <mode> <Name>
 *
 *   mode:
 *     fb    프론트엔드 ↔ 백엔드 (소켓 도메인)
 *     bs    백엔드 ↔ 시리얼포트 (하드웨어 서브프로세스)
 *     full  둘 다
 *
 * 설계 원칙: 정의는 kiosk-types 에 1회 생성하고, 소비 레포(backend/frontend/
 * serialport)에는 re-export + 와이어링만 주입한다. 기존 파일 주입은 `// @gen:*` 앵커
 * 마커 기준으로 멱등하게 수행한다.
 *
 * Phase 0: CLI 디스패치 골격만 — 각 모드는 아직 no-op 스텁이다.
 */
import { getWriteCount, resetWriteCount } from './fsutil';
import { findMissingMarkers, MODE_MARKERS } from './markers';
import { deriveNames, type Names } from './naming';
import { TYPES } from './paths';
import {
  emitBsBackend,
  emitBsBackendTransport,
  emitFbBackend,
  emitFbBackendWiring,
  emitFullBackendService,
} from './targets/backend';
import { emitCi } from './targets/ci';
import { emitFbFrontend } from './targets/frontend';
import { emitSerialportPackage } from './targets/serialport';
import { emitBsTypes, emitFbTypes } from './targets/types';

const MODES = ['fb', 'bs', 'full'] as const;
type Mode = (typeof MODES)[number];

const isMode = (s: string): s is Mode =>
  (MODES as readonly string[]).includes(s);

function usage(): never {
  console.error(
    [
      '',
      '사용법: bun gen <mode> <Name>',
      '',
      '  mode:',
      '    fb    프론트엔드 ↔ 백엔드 (소켓 도메인)',
      '    bs    백엔드 ↔ 시리얼포트 (하드웨어)',
      '    full  둘 다',
      '',
      '  예: bun gen fb MobileId',
      '      bun gen bs ReceiptPrinter',
      '      bun gen full CardkeyDispenser',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * 계약 지문을 다시 굽는다.
 *
 * 지문은 레지스트리에서 파생된 상수 모듈이라, 새 네임스페이스·프로세스를 주입하고 나면
 * 반드시 다시 만들어야 한다 — 안 하면 Record<...> 를 만족하지 못해 **생성 직후 타입체크가
 * 깨진 상태로 남는다**(실측). 사람이 기억해야 하는 후속 단계를 남기지 않는다.
 */
async function regenerateContract(): Promise<void> {
  console.log('• 계약 지문 재생성 (bun run contract)');
  const proc = Bun.spawn(['bun', 'run', 'contract'], {
    cwd: TYPES,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `계약 지문 재생성 실패 (exit ${code}) — kiosk-types 에서 bun run contract 를 확인하세요.`,
    );
  }
}

function summary(repos: string[]): void {
  console.log(`\n✨ 완료. 건드린 서브모듈: ${repos.join(', ')}`);
  console.log(
    '   각 서브모듈에서 변경을 확인 후 커밋하세요 (루트는 submodule 포인터만 갱신).',
  );
}

// ── 모드별 러너 ───────────────────────────────────────
const runners: Record<Mode, (names: Names) => Promise<void>> = {
  fb: async (names) => {
    await emitFbTypes(names);
    await emitFbBackend(names);
    await emitFbFrontend(names);
    await regenerateContract();
    summary(['types', 'backend', 'frontend']);
  },
  bs: async (names) => {
    await emitBsTypes(names);
    await emitSerialportPackage(names);
    await emitBsBackend(names);
    await emitCi(names);
    await regenerateContract();
    summary(['types', 'serialport', 'backend', '루트(CI)']);
  },
  full: async (names) => {
    // types: 소켓(fb) + 시리얼(bs) 정의 둘 다
    await emitFbTypes(names);
    await emitBsTypes(names);
    // 시리얼포트 서브프로세스 패키지
    await emitSerialportPackage(names);
    // backend: fb 와이어링 + bs 트랜스포트 + 병합 서비스(한 서비스가 트랜스포트 호출)
    await emitFbBackendWiring(names);
    await emitBsBackendTransport(names);
    await emitFullBackendService(names);
    // frontend
    await emitFbFrontend(names);
    await emitCi(names);
    await regenerateContract();
    summary(['types', 'serialport', 'backend', 'frontend', '루트(CI)']);
  },
};

async function main(): Promise<void> {
  const [mode, nameInput, ...rest] = process.argv.slice(2);

  if (!mode || !nameInput) usage();
  if (!isMode(mode)) {
    console.error(`❌ 알 수 없는 mode: '${mode}' (fb | bs | full 중 하나)`);
    usage();
  }
  if (rest.length > 0) {
    console.error(`❌ 인자가 너무 많습니다: ${rest.join(' ')}`);
    usage();
  }

  const names = deriveNames(nameInput);

  // ── Pre-flight: 쓰기 전에 이 모드가 건드릴 앵커 마커가 모두 존재하는지 검증 ──
  // 하나라도 없으면 아무것도 쓰지 않고 즉시 실패한다(반쪽 생성 상태 방지).
  const missing = await findMissingMarkers(MODE_MARKERS[mode]);
  if (missing.length > 0) {
    console.error(
      `\n❌ pre-flight 실패 — 앵커 마커 누락 (아무것도 생성하지 않음):`,
    );
    for (const m of missing) console.error(`   - ${m}`);
    console.error(
      `\n   대상 파일에 누락된 // @gen:* 마커를 먼저 심으세요. (CLAUDE.md "새 도메인/하드웨어 추가하기" 참고)`,
    );
    process.exit(1);
  }

  console.log(`\n🚀 gen ${mode} — ${names.pascal}`);
  console.log(
    `   pascal=${names.pascal}  camel=${names.camel}  kebab=${names.kebab}  snake=${names.snake}  screaming=${names.screaming}\n`,
  );

  resetWriteCount();
  await runners[mode](names);

  if (getWriteCount() === 0) {
    console.warn(
      `\n⚠️  새로 생성/주입한 것이 없습니다 — '${names.pascal}' 이(가) 이미 전부 존재합니다 (이름 오타?).`,
    );
  }
}

main().catch((err) => {
  console.error('❌ 생성 실패:', err);
  process.exit(1);
});
