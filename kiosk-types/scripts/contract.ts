#!/usr/bin/env bun
/**
 * 계약 지문 생성기 — `bun run contract` (갱신) / `bun run contract --check` (검증).
 *
 * 산출물 `contract.json` 은 git 에 커밋된다. 스키마를 건드리면 어느 계약이 움직였는지
 * PR diff 로 바로 보이고, 갱신을 잊으면 --check 가 CI 에서 잡는다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeContractHashes } from '../src/contract/hash';

const OUT = join(import.meta.dirname, '..', 'contract.json');
/**
 * 런타임 소비용 TS 산출물. JSON import 는 소비 레포 4곳의 tsconfig(resolveJsonModule)를
 * 요구하지만, TS 파일이면 번들러·테스트러너 어디서나 그냥 import 된다.
 */
const OUT_TS = join(
  import.meta.dirname,
  '..',
  'src',
  'contract',
  'generated.ts',
);

const toModule = (hashes: ReturnType<typeof computeContractHashes>): string =>
  '// 이 파일은 `bun run contract` 가 생성합니다. 직접 수정하지 마세요.\n' +
  '// 계약 지문의 정의는 src/contract/{registry,canonical,hash}.ts 에 있습니다.\n\n' +
  `export const CONTRACT = ${JSON.stringify(hashes, null, 2)} as const;\n`;
const check = process.argv.includes('--check');

const computed = computeContractHashes();
const serialized = `${JSON.stringify(computed, null, 2)}\n`;

if (check) {
  const committed = readFileSync(OUT, 'utf8');
  const committedTs = readFileSync(OUT_TS, 'utf8');
  if (committed === serialized && committedTs === toModule(computed)) {
    console.log(`✓ contract.json 최신 (total=${computed.total.slice(0, 12)})`);
    process.exit(0);
  }
  console.error(
    '✗ contract.json 이 스키마와 어긋납니다. `bun run contract` 로 갱신하세요.\n',
  );
  const prev = JSON.parse(committed) as typeof computed;
  const moved = (kind: 'namespaces' | 'processes') =>
    Object.keys(computed[kind])
      .filter((k) => prev[kind][k] !== computed[kind][k])
      .map((k) => `  ~ ${k}`);
  const added = (kind: 'namespaces' | 'processes') =>
    Object.keys(computed[kind])
      .filter((k) => !(k in prev[kind]))
      .map((k) => `  + ${k}`);
  const removed = (kind: 'namespaces' | 'processes') =>
    Object.keys(prev[kind])
      .filter((k) => !(k in computed[kind]))
      .map((k) => `  - ${k}`);
  for (const kind of ['namespaces', 'processes'] as const) {
    const lines = [...added(kind), ...removed(kind), ...moved(kind)];
    if (lines.length) console.error(`${kind}:\n${lines.join('\n')}`);
  }
  process.exit(1);
}

writeFileSync(OUT, serialized);
writeFileSync(OUT_TS, toModule(computed));
console.log(`계약 지문 (total=${computed.total.slice(0, 12)})\n`);
const pad = Math.max(
  ...Object.keys({ ...computed.namespaces, ...computed.processes }).map(
    (k) => k.length,
  ),
);
console.log('  프론트엔드 ↔ 백엔드');
for (const [ns, h] of Object.entries(computed.namespaces)) {
  console.log(`    ${ns.padEnd(pad)}  ${h.slice(0, 16)}`);
}
console.log('\n  백엔드 ↔ serialport');
for (const [proc, h] of Object.entries(computed.processes)) {
  console.log(`    ${proc.padEnd(pad)}  ${h.slice(0, 16)}`);
}
console.log(`\n→ ${OUT}\n→ ${OUT_TS}`);
