import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  EMPTY_ROLLBACK_STACK,
  ROLLBACK_STACK_FILE,
  type RollbackStack,
  RollbackStackSchema,
} from 'kiosk-types/src/update/rollbackStack';

/**
 * 되돌림 스택의 저장소 — `last-apply.json` 과 같은 자리·같은 방식(임시 파일 + rename).
 *
 * 쓰는 주체는 부모 하나다. 백엔드는 읽기만 한다(supervisor 가 적용 기록을 읽는 것과 같다).
 */
export type RollbackStackStore = {
  /** 없거나 읽을 수 없으면 빈 스택 — 기록이 부팅을 막지 않는다. */
  read(): RollbackStack;
  write(stack: RollbackStack): void;
};

export function createRollbackStackStore(deps: {
  /** 앱 설치가 지우지 않는 자리여야 한다. */
  dir: string;
  onLog?: (message: string) => void;
}): RollbackStackStore {
  const file = path.join(deps.dir, ROLLBACK_STACK_FILE);
  const log = deps.onLog ?? (() => undefined);

  mkdirSync(deps.dir, { recursive: true });

  return {
    read() {
      if (!existsSync(file)) return EMPTY_ROLLBACK_STACK;
      try {
        return RollbackStackSchema.parse(
          JSON.parse(readFileSync(file, 'utf-8')),
        );
      } catch (error) {
        log(
          `${ROLLBACK_STACK_FILE} 을 읽을 수 없습니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return EMPTY_ROLLBACK_STACK;
      }
    },

    write(stack) {
      const staging = `${file}.staging`;
      writeFileSync(staging, `${JSON.stringify(stack, null, 2)}\n`);
      renameSync(staging, file);
    },
  };
}
