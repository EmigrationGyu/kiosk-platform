import type { z } from 'zod';
import * as E from '../events/index';
import { NAMESPACES, type Namespace } from '../namespaces';
import * as S from '../serialport/index';
import {
  SERIALPORT_PROCESS,
  type SerialportProcess,
} from './../serialport/processes';

/**
 * 계약 지문의 입력 — 어느 통신 상대와 어떤 스키마 맵으로 말하는지의 단일 출처.
 *
 * 네이밍 규칙으로 자동 수집하지 않고 명시적으로 적는다. 규칙에 기대면 새 도메인이
 * 조용히 빠져 "계약이 안 바뀐 것처럼" 보이는데, 그건 이 장치가 막으려는 바로 그 사고다.
 * `satisfies` 가 닫힌 집합 누락을 컴파일 타임에 잡는다.
 */
export type SchemaPair = {
  request: Record<string, z.ZodType>;
  response: Record<string, z.ZodType>;
};

/** 프론트엔드 ↔ 백엔드 — 네임스페이스 단위. */
export const NAMESPACE_SCHEMAS = {
  [NAMESPACES.HARDWARE]: {
    request: E.HardwareSchemas,
    response: E.HardwareResponseSchemas,
  },
  [NAMESPACES.LOG]: {
    request: E.LogSchemas,
    response: E.LogResponseSchemas,
  },
  [NAMESPACES.PERMISSION]: {
    request: E.PermissionSchemas,
    response: E.PermissionResponseSchemas,
  },
  [NAMESPACES.FILESYSTEM]: {
    request: E.FileSystemSchemas,
    response: E.FileSystemResponseSchemas,
  },
  [NAMESPACES.IME]: {
    request: E.ImeSchemas,
    response: E.ImeResponseSchemas,
  },
  [NAMESPACES.UPDATE]: {
    request: E.UpdateSchemas,
    response: E.UpdateResponseSchemas,
  },
  [NAMESPACES.TOKEN_DISPENSER]: {
    request: E.TokenDispenserSchemas,
    response: E.TokenDispenserResponseSchemas,
  },
  [NAMESPACES.OUTBOX]: {
    request: E.OutboxClientSchemas,
    response: E.OutboxClientResponseSchemas,
  },
  // @gen:contract-namespace
} satisfies Record<Namespace, SchemaPair>;

/** 백엔드 ↔ serialport 서브프로세스 — 프로세스 단위. */
export const PROCESS_SCHEMAS = {
  [SERIALPORT_PROCESS.IME]: {
    request: S.ImeSerialSchemas,
    response: S.ImeSerialResponseSchemas,
  },
  [SERIALPORT_PROCESS.TOKEN_DISPENSER]: {
    request: S.TokenDispenserSerialSchemas,
    response: S.TokenDispenserSerialResponseSchemas,
  },
  [SERIALPORT_PROCESS.OUTBOX]: {
    request: S.OutboxSerialSchemas,
    response: S.OutboxSerialResponseSchemas,
  },
  // @gen:contract-process
} satisfies Record<SerialportProcess, SchemaPair>;
