import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { rel } from './paths';

// 실제로 생성/주입한 횟수. 한 번의 gen 실행에서 0 이면 "이미 전부 존재"(오타 의심)로 경고.
let writeCount = 0;
export const resetWriteCount = (): void => {
  writeCount = 0;
};
export const getWriteCount = (): number => writeCount;

/** 새 파일을 생성한다. 이미 있으면 건너뛴다(멱등). */
export async function writeNew(path: string, content: string): Promise<void> {
  if (existsSync(path)) {
    console.log(`  ⏭️  exists, skip: ${rel(path)}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  writeCount++;
  console.log(`  ✅ create:     ${rel(path)}`);
}

/**
 * `// @gen:<marker>` 앵커 라인 바로 앞에 `line`(여러 줄 가능)을 삽입한다.
 *
 * 앵커의 들여쓰기를 그대로 따른다. 이미 같은 내용이면 건너뛴다(멱등) — 멀티라인은
 * `dedupeKey`(없으면 `line.trim()`)로 존재 여부를 판단한다.
 */
export async function insertBeforeMarker(
  path: string,
  marker: string,
  line: string,
  dedupeKey?: string,
  /** 주석 토큰. YAML 등 `//` 를 쓰지 않는 파일에 주입할 때 넘긴다. */
  commentToken = '//',
): Promise<void> {
  const anchor = `${commentToken} @gen:${marker}`;
  const content = await readFile(path, 'utf-8');

  const key = dedupeKey ?? line.trim();
  if (content.includes(key)) {
    console.log(`  ⏭️  wired already (${marker}): ${rel(path)}`);
    return;
  }

  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.trim() === anchor);
  if (idx === -1) {
    throw new Error(`앵커 '${anchor}' 를 찾을 수 없습니다: ${rel(path)}`);
  }

  const anchorLine = lines[idx];
  const indent = anchorLine.slice(0, anchorLine.indexOf(commentToken));
  const inserted = line.split('\n').map((l) => (l.length > 0 ? indent + l : l));
  lines.splice(idx, 0, ...inserted);

  await writeFile(path, lines.join('\n'));
  writeCount++;
  console.log(`  ✅ wire (${marker}): ${rel(path)}`);
}
