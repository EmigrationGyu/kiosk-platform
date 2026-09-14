import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  APPLY_RECORD_FILE,
  type ApplyRecord,
  ApplyRecordSchema,
  EMPTY_ROLLBACK_STACK,
  LOCAL_UPDATE_DIR,
  ROLLBACK_INTENT_FILE,
  ROLLBACK_STACK_FILE,
  type RollbackIntent,
  RollbackIntentSchema,
  type RollbackStack,
  RollbackStackSchema,
} from 'kiosk-types';
import { KIOSK_HOME_DIR } from 'src/constant/LogPaths';

/**
 * 홈 디렉토리의 롤백 파일들 — 설치본이 갈려도 남는 자리.
 *
 * 스택은 **읽기만** 한다. 쓰는 주체는 부모(메인)뿐이고, 여기서 쓰면 주인이 둘이 된다
 * (supervisor 가 적용 기록을 읽기만 하는 것과 같은 규칙). intent 는 백엔드가 남기고
 * 다시 뜬 백엔드가 거둔다 — 주인이 하나다.
 */
const UPDATE_DIR = path.join(KIOSK_HOME_DIR, LOCAL_UPDATE_DIR);
const STACK = path.join(UPDATE_DIR, ROLLBACK_STACK_FILE);
const INTENT = path.join(UPDATE_DIR, ROLLBACK_INTENT_FILE);
const RECORD = path.join(UPDATE_DIR, APPLY_RECORD_FILE);

function readJson<T>(file: string, parse: (raw: unknown) => T, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return parse(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return fallback;
  }
}

export const readRollbackStack = (): RollbackStack =>
  readJson(
    STACK,
    (raw) => RollbackStackSchema.parse(raw),
    EMPTY_ROLLBACK_STACK,
  );

export const readRollbackIntent = (): RollbackIntent | null =>
  readJson(INTENT, (raw) => RollbackIntentSchema.parse(raw), null);

/** 마지막 적용 기록 — 보고용 읽기. 쓰는 것(`reported` 포함)은 부모뿐이다. */
export const readApplyRecord = (): ApplyRecord | null =>
  readJson(RECORD, (raw) => ApplyRecordSchema.parse(raw), null);

export function writeRollbackIntent(intent: RollbackIntent): void {
  mkdirSync(UPDATE_DIR, { recursive: true });
  writeFileSync(INTENT, `${JSON.stringify(intent, null, 2)}\n`);
}

export const clearRollbackIntent = (): void => rmSync(INTENT, { force: true });
