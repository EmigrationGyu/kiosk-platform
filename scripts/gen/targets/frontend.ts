import { join } from 'node:path';
import { writeNew } from '../fsutil';
import type { Names } from '../naming';
import { FRONTEND } from '../paths';

/**
 * fb 모드 — kiosk-frontend 에 소켓 도메인 소비 코드를 생성한다.
 * 이벤트 re-export(응답 검증용 ResponseSchemas 포함) + Transport 클래스.
 * Namespaces 는 이미 types 를 re-export 하므로 무수정.
 */
export async function emitFbFrontend(n: Names): Promise<void> {
  console.log('• frontend (kiosk-frontend)');
  const shared = join(FRONTEND, 'src', 'shared');

  await writeNew(
    join(shared, 'constants', 'events', `${n.pascal}.ts`),
    `export {
  ${n.screaming}_EVENTS,
  ${n.pascal}Schemas,
  ${n.pascal}ResponseSchemas,
  type ${n.pascal}EventMap,
} from 'kiosk-types';
`,
  );

  await writeNew(
    join(shared, 'transport', `${n.pascal}.ts`),
    `import { NAMESPACES } from '../constants/Namespaces';
import { Transport } from 'transport/Transport';
import { ${n.pascal}ResponseSchemas } from '../constants/events/${n.pascal}';
import type { ${n.pascal}EventMap } from '../constants/events/${n.pascal}';

export class ${n.pascal} extends Transport<${n.pascal}EventMap> {
  public constructor() {
    super(NAMESPACES.${n.screaming}, ${n.pascal}ResponseSchemas);
  }
}
`,
  );
}
