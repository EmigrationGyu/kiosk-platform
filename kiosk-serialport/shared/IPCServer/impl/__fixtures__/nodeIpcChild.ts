/**
 * node-ipc 통합 테스트의 자식 — 부모가 `child_process.fork` 로 띄운다.
 *
 * 실제 패키지 엔트리(index.ts)가 하는 것과 같은 순서다: Logger origin 확정 →
 * 정체 신고 → Router 서브. 지문(ownSurface)이 그 신고에서 오므로 순서가 의미를 갖는다.
 */
import { z } from 'zod';
import { logContractFingerprint } from '@/shared/contract/fingerprint';
import { Logger } from '@/shared/Logger';
import { Router } from '../node-ipc';

Logger.getInstance('ime');
logContractFingerprint('ime');

const schemas = { '/echo': z.object({ n: z.number() }) } as Record<
  string,
  z.ZodSchema
>;

class ChildRouter extends Router<Record<string, never>> {
  constructor() {
    super('unused-base-path', schemas);
  }
}

new ChildRouter().serveAll({
  '/echo': async (body: { n: number }, res: any) =>
    res.ok(200, { n: body.n * 2 }),
} as never);

process.send?.({ boot: 'ready' });
