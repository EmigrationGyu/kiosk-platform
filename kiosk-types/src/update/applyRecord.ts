import { z } from 'zod';
import { GenerationMapSchema } from './generation';

export const APPLY_RECORD_FILE = 'last-apply.json';

/**
 * 적용이 어떻게 끝났는가 — 닫힌 집합. 소프트웨어가 답했는지만 가른다. 하드웨어 고장은 업데이트
 * 전후로 같은 사실이라 여기 섞이지 않는다(승격 정책과 같은 기준).
 */
export const APPLY_OUTCOME = {
  /** 교체됐고 새 조합이 섰다. */
  APPLIED: 'applied',
  /**
   * 시킨 대로 이미 돌고 있어 바꿀 것이 없었다. `DECLINED` 와 가르는 이유: 운영자가 원한 상태가
   * **이미 참**이므로 시킨 일은 일어난 것이다. 같이 묶으면 같은 버전을 다시 보내는 흔한 동작이 화면에서
   * 빨갛게 뜨고, 서버는 이미 COMPLETED 로 닫아둔 뒤라 보고가 거절된다(실측).
   */
  UNCHANGED: 'unchanged',
  /** 아무것도 바꾸지 않았다 — 세대가 없거나, 되돌릴 스택이 비었다. */
  DECLINED: 'declined',
  /** 새 조합이 서지 못해 되감았다. */
  ROLLED_BACK: 'rolled-back',
  /** 계약이 어긋나 되감았다 — 섰지만 말이 안 통한다. */
  MISMATCH: 'mismatch',
  /** 적용 자체가 던졌다(포인터 쓰기 실패 등). */
  THREW: 'threw',
  /**
   * 앱 설치본에 넘겼다 — 결과는 여기서 볼 수 없다. 설치가 우리를 갈아치우므로 성공을 관측할 주체가
   * 남지 않는다. 다시 뜬 앱의 버전이 답이고, 이 값에 머물러 있는 기록은 곧 **설치가 끝나지 못했다**는 뜻이다.
   */
  INSTALLING: 'installing',
} as const;

export type ApplyOutcomeKind =
  (typeof APPLY_OUTCOME)[keyof typeof APPLY_OUTCOME];

/**
 * 마지막 적용의 결과 기록.
 *
 * **교체당하는 쪽은 자기 결과를 보고할 수 없다.** 지시를 보낸 렌더러는 리로드되고 요청한 백엔드는
 * 죽으므로, 살아남는 부모가 파일로 남기고 다시 뜬 렌더러가 읽어 서버로 되돌려보낸다. 앱 재기동·
 * supervisor kill 을 넘어야 하므로 메모리가 아니라 파일이다.
 */
export const ApplyRecordSchema = z.object({
  recordVersion: z.literal(1),
  /** 서버 알림 id(= 발송의 batchId). 워치독이 스스로 내려간 경우처럼 지시가 없으면 null. */
  commandId: z.string().nullable(),
  /**
   * 도메인 → 서버 배포 행 id. 서버는 결과를 **행 단위**로 받는데 적용은 조합 단위라, 접기 전의
   * 좌표를 여기 남겨야 다시 펼 수 있다(재부팅을 넘겨 보고하므로 기록에 실린다).
   * `recordVersion` 을 올리지 않는 이유: 올리면 이미 배포된 키오스크가 자기 옛 기록을 못 읽는다.
   */
  deploymentIds: z.record(z.string(), z.string()).default({}),
  at: z.string(),
  /** 지시가 요구한 조합. 무엇의 어느 버전이 문제였는지가 여기서 나온다. */
  requested: GenerationMapSchema,
  /** 앱 설치 지시였다면 그 버전 — 세대가 아니라 다른 축이라 따로 둔다. */
  requestedBase: z.string().nullable().default(null),
  outcome: z.enum(APPLY_OUTCOME),
  /** 사람이 읽는 사유 한 줄 — 닫힌 집합이 아니라 진단용. */
  detail: z.string(),
  /** 되감았다면 어디까지. */
  rolledBackTo: z.enum(['stable', 'baseline']).nullable(),
  /** 서버로 되돌려보냈는가. 보고 소비처가 표시한다. */
  reported: z.boolean(),
});

export type ApplyRecord = z.infer<typeof ApplyRecordSchema>;

/**
 * 백엔드가 부모에게 넘기는 결과 — 부모가 그대로 기록으로 굳힌다. 시각과 `reported` 는 넘기지
 * 않는다: 쓰는 주체가 채워야 기록의 시각이 **쓰인 때**를 뜻하고, 넘기는 쪽이 채우면 주인이 둘이 된다.
 */
export const ApplyReportSchema = z.object({
  commandId: z.string().nullable(),
  deploymentIds: z.record(z.string(), z.string()).default({}),
  requested: GenerationMapSchema.default({}),
  requestedBase: z.string().nullable().default(null),
  outcome: z.enum(APPLY_OUTCOME),
  detail: z.string(),
});

export type ApplyReport = z.infer<typeof ApplyReportSchema>;
