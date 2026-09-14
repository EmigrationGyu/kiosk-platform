import { existsSync, readFileSync, renameSync, watch } from 'node:fs';
import path from 'node:path';
import { platform } from '@platform/Platform';
import { ManifestSchema } from 'kiosk-types';
import { LogService } from 'src/service/LogService';
import { z } from 'zod';
import { applyManifest } from './applyManifest';
import { rollback } from './rollback';

const HarnessRollbackSchema = z.object({ rollback: z.literal(true) });

/**
 * 파일로 놓인 지시를 집어 적용한다 — **하네스 전용 문**이다.
 *
 * 실제 지시는 서버 구독 → 프론트 큐 → `UPDATE_EVENTS.APPLY` 로 오고, 이 문은 **안전한
 * 화면인지 판단을 건너뛴다**(장치가 idle 인지 보지 않는다). 실기기 운영에서는 이 파일이
 * 놓이지 않으므로 도달하지 않는 경로다. 백엔드·부모 절반을 서버 없이 회귀 검증하는
 * 레버로 남겨둔다.
 */
const PENDING_MANIFEST = 'pending-manifest.json';

export function startApplyTrigger(): void {
  const root = platform.paths.baseline;
  const pending = path.join(root, PENDING_MANIFEST);
  const logger = LogService.getInstance();

  /**
   * 소비를 직렬화한다.
   *
   * `fs.watch` 는 파일 하나에 이벤트를 여러 번 쏜다(Windows 는 create+change). 그러면
   * `consume` 이 동시에 들어와 둘 다 존재 검사를 통과하고, **게이트를 두 번 잠갔다 두 번
   * 푼다** — 첫 잠금이 풀리는 순간 창이 생긴다(실측: 11ms 간격 이중 적용).
   */
  let consuming = false;

  const consume = async (): Promise<void> => {
    if (consuming) return;
    if (!existsSync(pending)) return;
    consuming = true;
    try {
      await take();
    } finally {
      consuming = false;
    }
    // 적용 중에 온 watch 이벤트는 버려졌다 — 그 사이 놓인 지시를 다시 집는다.
    // 백엔드가 살아남는 결과(프론트·장치 단독, 세대 없음)에서만 여기에 도달한다.
    await consume();
  };

  const take = async (): Promise<void> => {
    // **읽기 전에** 치운다. 같은 지시를 두 번 처리하지 않기 위해서이기도 하고, 형식이
    // 틀린 지시를 남겨두면 끝나고 다시 집으러 오는 쪽이 영원히 같은 파일을 붙든다.
    const consumed = `${pending}.consumed`;
    renameSync(pending, consumed);

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(consumed, 'utf-8'));
    } catch {
      logger.error('[업데이트] 매니페스트를 읽을 수 없습니다');
      return;
    }

    // 서버 지시가 아니므로 맞대볼 commandId 가 없다.
    // `{ rollback: true }` 는 롤백 지시 — 목적지 없이, 서버 경로와 같은 모양이다.
    if (HarnessRollbackSchema.safeParse(raw).success) {
      await rollback({ commandId: null });
      return;
    }

    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error('[업데이트] 매니페스트 형식 오류 — 무시합니다');
      return;
    }

    // 하네스 파일에서 온 지시 — 서버 행이 없으므로 보고할 좌표도 없다.
    await applyManifest({
      commandId: null,
      deploymentIds: {},
      manifest: parsed.data,
    });
  };

  // 재기동 직후 이미 놓여 있는 지시도 집어간다.
  void consume();

  watch(root, (_event, filename) => {
    if (filename === PENDING_MANIFEST) void consume();
  });
}
