import { join } from 'node:path';
import { insertBeforeMarker } from '../fsutil';
import type { Names } from '../naming';
import { ROOT } from '../paths';

/**
 * bs 모드 — 컴포넌트 단위 릴리스 워크플로의 선택지에 새 디바이스를 주입한다.
 *
 * CI 는 serialport 대상 목록을 계약의 단일 출처(`SERIALPORT_PROCESS`)에서 파생하므로
 * 빌드·업로드 경로는 여기 손댈 필요가 없다. **딱 한 곳만 예외**인데,
 * `workflow_dispatch` 의 `choice` 옵션은 정적 YAML 이어야 해서 계산이 불가능하다.
 * 그래서 이 목록에만 마커를 두고 주입한다.
 */
export async function emitCi(n: Names): Promise<void> {
  console.log('• CI (release-component.yml)');

  await insertBeforeMarker(
    join(ROOT, '.github', 'workflows', 'release-component.yml'),
    'ci-component',
    `- ${n.kebab}`,
    `- ${n.kebab}\n`,
    '#',
  );
}
