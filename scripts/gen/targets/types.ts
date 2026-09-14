import { join } from 'node:path';
import { insertBeforeMarker, writeNew } from '../fsutil';
import type { Names } from '../naming';
import { TYPES } from '../paths';

/**
 * fb 모드 — kiosk-types 에 소켓 도메인 정의를 생성한다(단일 진실 공급원).
 * EVENTS 상수 + 요청/응답 Zod 스키마 + `{request,response}` EventMap + 네임스페이스 + 배럴.
 */
export async function emitFbTypes(n: Names): Promise<void> {
  console.log('• types (kiosk-types)');

  await writeNew(
    join(TYPES, 'src', 'events', `${n.kebab}.ts`),
    `import { z } from 'zod';

export const ${n.screaming}_EVENTS = {
  PING: '/ping',
} as const;

export const ${n.pascal}Schemas = {
  [${n.screaming}_EVENTS.PING]: z.void(),
};

// ── Response schemas ─────────────────────────────────────────────────────────

export const ${n.pascal}ResponseSchemas = {
  [${n.screaming}_EVENTS.PING]: z.literal('pong'),
};

export type ${n.pascal}EventMap = {
  [${n.screaming}_EVENTS.PING]: {
    request: z.infer<(typeof ${n.pascal}Schemas)[typeof ${n.screaming}_EVENTS.PING]>;
    response: z.infer<(typeof ${n.pascal}ResponseSchemas)[typeof ${n.screaming}_EVENTS.PING]>;
  };
};
`,
  );

  await insertBeforeMarker(
    join(TYPES, 'src', 'namespaces.ts'),
    'namespace',
    `${n.screaming}: '/${n.snake}',`,
  );

  // 계약 레지스트리 — 여기 빠지면 `Record<Namespace, SchemaPair>` 를 만족하지 못해
  // types 가 타입체크에 실패한다. 계약이 닫힌 집합이라 누락이 곧 컴파일 에러다.
  await insertBeforeMarker(
    join(TYPES, 'src', 'contract', 'registry.ts'),
    'contract-namespace',
    `[NAMESPACES.${n.screaming}]: {
    request: E.${n.pascal}Schemas,
    response: E.${n.pascal}ResponseSchemas,
  },`,
    `NAMESPACES.${n.screaming}]`,
  );

  await insertBeforeMarker(
    join(TYPES, 'src', 'events', 'index.ts'),
    'export',
    `export * from './${n.kebab}';`,
  );
}

/**
 * bs 모드 — kiosk-types 에 시리얼 통신 정의를 생성한다(단일 진실 공급원).
 * ENDPOINTS + 요청/응답 Zod 스키마 + serial EventMap + serialport 배럴.
 */
export async function emitBsTypes(n: Names): Promise<void> {
  console.log('• types (kiosk-types) — serialport');

  await writeNew(
    join(TYPES, 'src', 'serialport', `${n.kebab}.ts`),
    `import { z } from 'zod';
import { SerialOptionsSchema } from './common';

export const ${n.screaming}_ENDPOINTS = {
  PORT_ASSIGNED: '/${n.snake}/port-assigned',
  /** 성공 = 이 서브프로세스가 COM 포트를 쥐고 있지 않음(멱등). serialport README 참고. */
  RELEASE_PORT: '/${n.snake}/release-port',
  HEALTH_CHECK: '/${n.snake}/health-check',
} as const;

export const ${n.pascal}SerialSchemas = {
  [${n.screaming}_ENDPOINTS.PORT_ASSIGNED]: SerialOptionsSchema,
  [${n.screaming}_ENDPOINTS.RELEASE_PORT]: z.void(),
  [${n.screaming}_ENDPOINTS.HEALTH_CHECK]: z.void(),
};

// ── Response schemas (backend Transport 의 IPC 응답 검증용) ──────────────────

export const ${n.pascal}SerialResponseSchemas = {
  [${n.screaming}_ENDPOINTS.PORT_ASSIGNED]: z.void(),
  [${n.screaming}_ENDPOINTS.RELEASE_PORT]: z.void(),
  [${n.screaming}_ENDPOINTS.HEALTH_CHECK]: z.void(),
};

export type ${n.pascal}SerialEventMap = {
  [${n.screaming}_ENDPOINTS.PORT_ASSIGNED]: {
    request: z.infer<typeof SerialOptionsSchema>;
    response: void;
  };
  [${n.screaming}_ENDPOINTS.RELEASE_PORT]: {
    request: void;
    response: void;
  };
  [${n.screaming}_ENDPOINTS.HEALTH_CHECK]: {
    request: void;
    response: void;
  };
};
`,
  );

  // 계약 레지스트리 — 위와 같은 이유로 필수다.
  await insertBeforeMarker(
    join(TYPES, 'src', 'contract', 'registry.ts'),
    'contract-process',
    `[SERIALPORT_PROCESS.${n.screaming}]: {
    request: S.${n.pascal}SerialSchemas,
    response: S.${n.pascal}SerialResponseSchemas,
  },`,
    `SERIALPORT_PROCESS.${n.screaming}]`,
  );

  await insertBeforeMarker(
    join(TYPES, 'src', 'serialport', 'index.ts'),
    'serial-export',
    `export * from './${n.kebab}';`,
  );

  // processes.ts — 서브프로세스 식별자 + named pipe 상수(단일 출처).
  // backend(events re-export)·serialport(router import) 가 이 상수를 참조한다.
  const processes = join(TYPES, 'src', 'serialport', 'processes.ts');
  await insertBeforeMarker(
    processes,
    'serialport-process',
    `${n.screaming}: '${n.kebab}',`,
    `${n.screaming}: '${n.kebab}'`,
  );
  await insertBeforeMarker(
    processes,
    'serialport-pipe',
    `export const ${n.screaming}_PIPE_PATH = serialportPipePath(
  SERIALPORT_PROCESS.${n.screaming},
);`,
    `${n.screaming}_PIPE_PATH`,
  );

  // events/hardware.ts — 프리웜 가능 집합(WARMABLE_PROCESSES)에 편입.
  // 백엔드 워밍 전략 맵이 이 집합을 satisfies 로 강제하므로, 여기 추가되면
  // targets/backend.ts 의 warmup-strategy 주입이 짝으로 따라와야 컴파일이 통과한다.
  await insertBeforeMarker(
    join(TYPES, 'src', 'events', 'hardware.ts'),
    'warmable',
    `SERIALPORT_PROCESS.${n.screaming},`,
  );
}
