import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  APPLY_RECORD_FILE,
  type ApplyRecord,
  ApplyRecordSchema,
} from 'kiosk-types/src/update/applyRecord';

/**
 * 마지막 적용 결과의 저장소. 결과를 아는 것은 부모뿐이다 — 지시를 보낸 렌더러는 리로드되고
 * 요청한 백엔드는 죽는다. 부모가 파일로 남기고, 다시 뜬 렌더러가 읽어 서버로 되돌려보낸다.
 *
 * 포인터와 같은 자리·같은 방식(임시 파일 + rename)이다. 업데이트가 실패한 순간이야말로 전원이
 * 나가거나 supervisor 가 앱을 죽이는 순간이라, 중간 상태가 남으면 안 된다.
 */
export type ApplyRecordStore = {
  write(record: ApplyRecord): void;
  /** 없거나 읽을 수 없으면 null — 기록이 부팅을 막지 않는다. */
  read(): ApplyRecord | null;
  /**
   * `at` 이 가리키는 기록에 "서버에 갔다"를 세운다. 그 사이 새 기록이 쓰였으면 세우지
   * 않는다 — 옛 보고가 새 기록을 보고된 것으로 만들면 안 된다. 세웠는지 돌려준다.
   */
  markReported(at: string): boolean;
};

export function createApplyRecordStore(deps: {
  /** 기록이 놓일 디렉토리 — 앱 설치가 지우지 않는 자리여야 한다. */
  dir: string;
  onLog?: (message: string) => void;
}): ApplyRecordStore {
  const file = path.join(deps.dir, APPLY_RECORD_FILE);
  const log = deps.onLog ?? (() => undefined);

  // 패키지 안이 아니라 홈 아래라 첫 실행에는 없다 — 없으면 기록이 통째로 유실된다.
  mkdirSync(deps.dir, { recursive: true });

  const write = (record: ApplyRecord): void => {
    const staging = `${file}.staging`;
    writeFileSync(staging, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(staging, file);
  };

  return {
    write,

    markReported(at) {
      const current = this.read();
      if (current === null || current.at !== at || current.reported) {
        return false;
      }
      write({ ...current, reported: true });
      return true;
    },

    read() {
      if (!existsSync(file)) return null;
      try {
        return ApplyRecordSchema.parse(JSON.parse(readFileSync(file, 'utf-8')));
      } catch (error) {
        log(
          `${APPLY_RECORD_FILE} 을 읽을 수 없습니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    },
  };
}
