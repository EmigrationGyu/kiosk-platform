import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKEND, ROOT, rel, TYPES } from './paths';

/** 한 파일에서 존재해야 하는 `@gen:*` 마커들. YAML 등은 주석 토큰을 지정한다. */
export type MarkerRef = {
  file: string;
  markers: string[];
  commentToken?: string;
};

const ts = join(TYPES, 'src');
const be = join(BACKEND, 'src');

// fb 모드가 주입하는 마커 (targets/types.ts, targets/backend.ts 와 동기 유지)
const FB: MarkerRef[] = [
  { file: join(ts, 'namespaces.ts'), markers: ['namespace'] },
  { file: join(ts, 'events', 'index.ts'), markers: ['export'] },
  {
    file: join(ts, 'contract', 'registry.ts'),
    markers: ['contract-namespace'],
  },
  {
    file: join(be, 'types', 'Namespaces.ts'),
    markers: ['import', 'nsmap', 'ns-events'],
  },
  { file: join(be, 'app.ts'), markers: ['import', 'field', 'init', 'serve'] },
];

// bs 모드가 주입하는 마커 (targets/types.ts, targets/backend.ts 와 동기 유지)
const BS: MarkerRef[] = [
  {
    file: join(ts, 'serialport', 'processes.ts'),
    markers: ['serialport-process', 'serialport-pipe'],
  },
  { file: join(ts, 'serialport', 'index.ts'), markers: ['serial-export'] },
  { file: join(ts, 'contract', 'registry.ts'), markers: ['contract-process'] },
  // 프리웜(WARMUP) — 새 서브프로세스는 warmable 닫힌 집합 + 백엔드 워밍 전략에 자동 편입
  { file: join(ts, 'events', 'hardware.ts'), markers: ['warmable'] },
  {
    file: join(be, 'controller', 'HardwareController.ts'),
    markers: ['warmup-import', 'warmup-strategy'],
  },
  // CI — serialport 대상 목록은 계약 단일 출처에서 파생하지만, workflow_dispatch 의
  // choice 옵션만은 정적 YAML 이어야 해서 계산할 수 없다. 그 한 곳만 주입한다.
  {
    file: join(ROOT, '.github', 'workflows', 'release-component.yml'),
    markers: ['ci-component'],
    commentToken: '#',
  },
  // electron·dev 스크립트는 주입 대상이 아니다. 둘 다 예전엔 디바이스 목록을 들고 직접
  // spawn 했지만, 자식 생명주기가 백엔드 processManager 로 넘어가면서 그 목록이 사라졌다
  // — electron 은 백엔드가 준 entry 를 그대로 fork 하고, dev 는 아예 띄우지 않는다(lazy).
  //
  // 즉 새 디바이스가 닿아야 하는 곳은 **계약(types)과 그 계약을 소비하는 백엔드**뿐이다.
];

/**
 * 모드별로 사전 검증할 마커 목록.
 * ⚠️ targets/* 의 insertBeforeMarker 호출과 동기를 유지해야 한다(누락 시 런타임 throw 가 백스톱).
 */
export const MODE_MARKERS: Record<'fb' | 'bs' | 'full', MarkerRef[]> = {
  fb: FB,
  bs: BS,
  full: [...FB, ...BS],
};

/**
 * 주어진 마커들이 대상 파일에 모두 존재하는지 검사한다.
 * 누락(파일 부재 포함) 항목을 사람이 읽을 수 있는 문자열 배열로 반환한다 — 비어있으면 통과.
 */
export async function findMissingMarkers(refs: MarkerRef[]): Promise<string[]> {
  const missing: string[] = [];
  for (const { file, markers, commentToken } of refs) {
    if (!existsSync(file)) {
      missing.push(`${rel(file)} (파일 없음)`);
      continue;
    }
    const content = await readFile(file, 'utf-8');
    for (const m of markers) {
      const anchor = `${commentToken ?? '//'} @gen:${m}`;
      if (!content.includes(anchor)) {
        missing.push(`${rel(file)} → ${anchor}`);
      }
    }
  }
  return missing;
}
