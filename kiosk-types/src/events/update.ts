import { z } from 'zod';
import { ManifestSchema } from '../update/generation';
import {
  ApplyResultReportSchema,
  SoftwareStateReportSchema,
} from '../update/report';

export const UPDATE_EVENTS = {
  /**
   * "부팅을 완주했다" — 렌더러가 홈까지 도달한 시점에 스스로 알린다.
   *
   * 승격 조건의 절반이다(나머지 절반은 백엔드가 보는 봉투 회수). 렌더러↔백엔드 사슬이 실제로 도는지는
   * 렌더러만 알 수 있고, 부모가 관측하는 이벤트(`dom-ready` 등)로는 대신할 수 없다. **평범한 트랜스포트
   * 요청**이라 플랫폼에 묶이지 않는다.
   */
  BOOT_COMPLETED: '/boot_completed',
  /**
   * "살아서 그리기 시작했다" — React 루트가 첫 커밋을 마친 직후 자동으로 알린다.
   *
   * 부팅 완주와 **다른 신호**다: 완주는 터치·네트워크가 껴 있어 무인 부팅에선 영영 오지 않을 수 있고,
   * 그걸 렌더러 준비 워치독의 해제 근거로 쓰면 멀쩡한 프론트를 되감는다(실측: 리로드 루프에 갇혔다).
   * 이 신호는 번들 평가와 첫 렌더만 증언하므로 흰 화면(JS 크래시)에서만 부재한다. 승격과는 무관하다.
   */
  RENDERER_ALIVE: '/renderer_alive',
  /**
   * "계약이 어긋난 응답을 받았다" — 지문 대조가 놓친 경우의 백스톱. 지문을 싣지 않는 옛 산출물이나
   * 지문은 같은데 실제로 말이 안 통하는 경우를 받는다. 실제로 실패한 호출이라 지문 대조보다
   * 정확하지만 **늦게** 드러난다.
   */
  CONTRACT_MISMATCH: '/contract_mismatch',
  /**
   * "지금 적용해라" — 서버 지시를 큐에 담아뒀던 렌더러가 **안전한 화면에서** 넘긴다. 적용 시점
   * 판단이 렌더러에 있는 이유: 장치가 idle 인지는 화면이 안다. 백엔드는 장치 in-flight 만 볼 수 있어
   * "다단계 작업의 중간"과 "정말 한가함"을 못 가른다.
   */
  APPLY: '/apply',
  /**
   * "직전 조합으로 돌아가라" — 되돌림 스택의 top 으로. 목적지는 서버가 아니라 키오스크가
   * 안다. 적용과 같은 큐·같은 안전한 화면 게이트를 탄다.
   */
  ROLLBACK: '/rollback',
  /**
   * "지금 무엇이 도는가" — 렌더러가 홈 진입 뒤 물어 서버로 보고한다. 백엔드가 답하는 이유:
   * 포인터·스택·기록은 파일이고 렌더러는 파일을 못 읽는다. 보내는 것이 렌더러인 이유: 서버로 가는
   * 뮤테이션과 outbox 가 렌더러에 있다.
   */
  SOFTWARE_STATE: '/software_state',
  /** "이 기록은 서버에 갔다" — 부모가 `reported` 를 세운다(기록의 주인은 부모다). */
  REPORTED: '/reported',
} as const;

export const UpdateSchemas = {
  /**
   * 렌더러가 자기 계약 지문을 함께 싣는다 — 백엔드가 조합 일관성을 판정한다. 판정에 쓰이는 것은
   * `surface`(프론트↔백엔드 합성 지문)다: total 로 대조하면 장치 스키마만 움직인 변경에도 프론트가
   * 불일치가 되어 부분 배포가 성립하지 않는다. optional 인 이유는 표면을 모르는 옛 프론트 세대의
   * 선언도 받아야 하기 때문이다(그 창은 런타임 백스톱이 받는다).
   */
  [UPDATE_EVENTS.BOOT_COMPLETED]: z.object({
    contractTotal: z.string(),
    surface: z.string().min(1).optional(),
  }),
  [UPDATE_EVENTS.RENDERER_ALIVE]: z.void(),
  [UPDATE_EVENTS.CONTRACT_MISMATCH]: z.object({ cause: z.string() }),
  /** commandId = 서버 알림 id — 결과를 그 지시와 맞대볼 수 있어야 한다. */
  [UPDATE_EVENTS.APPLY]: z.object({
    commandId: z.string().min(1),
    /**
     * 도메인 → 서버 배포 행 id — 결과를 행 단위로 되돌려보낼 좌표. 서버가 (키오스크, 도메인)마다
     * 행을 만들고 키오스크는 조합으로 접어 적용하므로, 접기 전의 좌표를 지시와 함께 나른다.
     * default 인 이유는 옛 렌더러가 보낸 지시도 파싱돼야 하기 때문이다(빈 맵 = 보고할 행 없음).
     */
    deploymentIds: z.record(z.string(), z.string()).default({}),
    manifest: ManifestSchema,
  }),
  [UPDATE_EVENTS.ROLLBACK]: z.object({ commandId: z.string().min(1) }),
  [UPDATE_EVENTS.SOFTWARE_STATE]: z.void(),
  /** 어느 기록인가 — 기록의 `at`. 그 사이 새 기록이 쓰였으면 세우지 않는다. */
  [UPDATE_EVENTS.REPORTED]: z.object({ at: z.string().min(1) }),
};

// ── Response schemas ─────────────────────────────────────────────────────────

export const UpdateResponseSchemas = {
  [UPDATE_EVENTS.BOOT_COMPLETED]: z.void(),
  [UPDATE_EVENTS.RENDERER_ALIVE]: z.void(),
  [UPDATE_EVENTS.CONTRACT_MISMATCH]: z.void(),
  [UPDATE_EVENTS.APPLY]: z.void(),
  [UPDATE_EVENTS.ROLLBACK]: z.void(),
  /** 상태와, 있으면 미보고 결과 — 한 왕복으로 둘 다 받는다. */
  [UPDATE_EVENTS.SOFTWARE_STATE]: z.object({
    state: SoftwareStateReportSchema,
    result: ApplyResultReportSchema.nullable(),
  }),
  [UPDATE_EVENTS.REPORTED]: z.void(),
};

export type UpdateEventMap = {
  [UPDATE_EVENTS.CONTRACT_MISMATCH]: {
    request: z.infer<
      (typeof UpdateSchemas)[typeof UPDATE_EVENTS.CONTRACT_MISMATCH]
    >;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.CONTRACT_MISMATCH]
    >;
  };
  [UPDATE_EVENTS.BOOT_COMPLETED]: {
    request: z.infer<
      (typeof UpdateSchemas)[typeof UPDATE_EVENTS.BOOT_COMPLETED]
    >;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.BOOT_COMPLETED]
    >;
  };
  [UPDATE_EVENTS.RENDERER_ALIVE]: {
    request: z.infer<
      (typeof UpdateSchemas)[typeof UPDATE_EVENTS.RENDERER_ALIVE]
    >;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.RENDERER_ALIVE]
    >;
  };
  [UPDATE_EVENTS.APPLY]: {
    request: z.infer<(typeof UpdateSchemas)[typeof UPDATE_EVENTS.APPLY]>;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.APPLY]
    >;
  };
  [UPDATE_EVENTS.ROLLBACK]: {
    request: z.infer<(typeof UpdateSchemas)[typeof UPDATE_EVENTS.ROLLBACK]>;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.ROLLBACK]
    >;
  };
  [UPDATE_EVENTS.SOFTWARE_STATE]: {
    request: z.infer<
      (typeof UpdateSchemas)[typeof UPDATE_EVENTS.SOFTWARE_STATE]
    >;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.SOFTWARE_STATE]
    >;
  };
  [UPDATE_EVENTS.REPORTED]: {
    request: z.infer<(typeof UpdateSchemas)[typeof UPDATE_EVENTS.REPORTED]>;
    response: z.infer<
      (typeof UpdateResponseSchemas)[typeof UPDATE_EVENTS.REPORTED]
    >;
  };
};
