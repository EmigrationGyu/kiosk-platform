import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import {
  CASCADE_POLICY,
  type CancelRequest,
  DEFAULT_RETRY_POLICY,
  type DrainResult,
  type EnqueueRequest,
  type EnqueueResult,
  type GetChainRequest,
  type GetChainResult,
  isTerminalFailure,
  isTerminalStatus,
  isTerminalSuccess,
  ON_DEP_FAIL,
  OUTBOX_ERROR_CODE,
  OUTBOX_STATUS,
  type OutboxCause,
  type OutboxStatus,
  type ResolveRequest,
  type Result,
  type ResultVoid,
  type RetryRequest,
  type SupersedeRequest,
  type SupersedeResult,
} from 'kiosk-types';
import { Logger } from '@/shared/Logger';
import type { Db, OutboxMutationRow } from '../db';
import { outboxDependency, outboxMutation } from '../db';

export type Clock = () => number;
/** 0 이상 1 미만의 부동소수. 기본값 Math.random — 테스트에서 결정적으로 주입 가능. */
export type RandomFn = () => number;

export type OutboxServiceDeps = {
  db: Db;
  clock?: Clock;
  random?: RandomFn;
};

const notImplemented = (label: string): never => {
  throw new Error(`[OutboxService] ${label} not implemented`);
};

/**
 * Outbox 도메인 로직 — 엔드포인트 작업(enqueue / drain / getChain / retry / resolve / cancel /
 * supersede) · 스케줄러가 부르는 내부 작업(pickReady / mark*) · 부팅 복구(resetInFlight) ·
 * 매 사이클 기한 스윕(expireOverdue).
 *
 * **자동 종결은 기한(expiresAt)만 한다.** markFailure 는 아무리 쌓여도 PENDING 으로 되돌릴 뿐이고,
 * 종결은 executor 의 permanent_failure(→DEAD) 또는 기한 만료(→EXPIRED), 아니면 운영자의
 * cancel/resolve 뿐이다.
 *
 * 실패는 모두 `Result.success=false` 의 **값**으로 반환한다 — throw 하지 않는다(시스템 예외만
 * 컨트롤러가 INTERNAL_ERROR 로 변환). Db / Clock 은 주입 가능하고, id 는 호출부가 항상 제공한다.
 */
export class OutboxService {
  private db: Db;
  private clock: Clock;
  private random: RandomFn;
  private logger = Logger.getInstance();

  constructor(deps: OutboxServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  // 엔드포인트 작업

  /**
   * 새 mutation 을 큐에 추가한다.
   *
   * - 같은 id + 같은 type → 기존 행 그대로 반환(deduplicated: true), 상태/payload 변경 없음
   * - 같은 id + 다른 type → ID_TYPE_MISMATCH · dependsOn 미존재 → DEPENDENCY_NOT_FOUND(부수효과 없음)
   * - rootId 미지정 시 id 와 동일(체인 시작점)
   * - 부모 종결-실패 + onDepFail=CANCEL → 즉시 CANCELLED 로 삽입하되 **부모를 카운트한다** — cascade 로
   *   CANCELLED 된 자식과 같은 모양이어야 retry(REACTIVATE)가 부활시켜도 부모를 기다린다
   * - 종결-성공 부모와 종결-실패+PROCEED 부모의 엣지는 settled 로 삽입 — 정상 경로에서 이미 보냈을
   *   감소 신호를 삽입 시점에 접는 것이라, 이후 resolve 가 그 엣지를 또 감소시키지 않는다
   */
  async enqueue(
    req: EnqueueRequest,
  ): Promise<Result<EnqueueResult, OutboxCause>> {
    const onDepFail = req.onDepFail ?? ON_DEP_FAIL.CANCEL;
    const dependsOnUnique = req.dependsOn
      ? Array.from(new Set(req.dependsOn))
      : [];
    const rootId = req.rootId ?? req.id;
    const now = this.clock();

    // 백오프 곡선 — 미지정 시 기본값.
    const initialBackoffMs =
      req.retryPolicy?.initialBackoffMs ??
      DEFAULT_RETRY_POLICY.INITIAL_BACKOFF_MS;
    const maxBackoffMs =
      req.retryPolicy?.maxBackoffMs ?? DEFAULT_RETRY_POLICY.MAX_BACKOFF_MS;
    // 미지정 = 기본 기한, 명시적 null = 무기한. 무기한은 선택이어야 한다.
    const expiresAt =
      req.expiresAt === undefined
        ? now + DEFAULT_RETRY_POLICY.DEFAULT_EXPIRY_MS
        : req.expiresAt;

    return this.db.transaction((tx) => {
      // 1. 같은 id 행 존재 시: dedup 또는 type 충돌 판정
      const existing = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, req.id))
        .get();

      if (existing) {
        if (existing.type === req.type) {
          return {
            success: true as const,
            data: {
              id: existing.id,
              rootId: existing.rootId,
              deduplicated: true,
            },
          };
        }
        return {
          success: false as const,
          cause: 'ID_TYPE_MISMATCH' as const,
          code: OUTBOX_ERROR_CODE.ID_TYPE_MISMATCH,
        };
      }

      // 2. dependsOn 부모 존재 검증 (부수효과 없는 read-only)
      let parents: OutboxMutationRow[] = [];
      if (dependsOnUnique.length > 0) {
        parents = tx
          .select()
          .from(outboxMutation)
          .where(inArray(outboxMutation.id, dependsOnUnique))
          .all();

        if (parents.length !== dependsOnUnique.length) {
          return {
            success: false as const,
            cause: 'DEPENDENCY_NOT_FOUND' as const,
            code: OUTBOX_ERROR_CODE.DEPENDENCY_NOT_FOUND,
          };
        }
      }

      // 3. pendingDepsCount · 초기 status · 엣지별 정산 여부 결정
      let pendingDepsCount = 0;
      let initialStatus: OutboxStatus = OUTBOX_STATUS.PENDING;
      const settledParentIds = new Set<string>();
      const failedCancelParentIds: string[] = [];

      for (const p of parents) {
        if (isTerminalSuccess(p.status)) {
          // 종결-성공 부모 — 의존성 만족. markSuccess 가 보냈을 감소를 접어 settled 로.
          settledParentIds.add(p.id);
          continue;
        }
        if (isTerminalFailure(p.status)) {
          if (onDepFail === ON_DEP_FAIL.CANCEL) {
            // cascade 로 CANCELLED 된 자식과 동형 — 카운트하고 엣지는 미정산으로 남긴다.
            initialStatus = OUTBOX_STATUS.CANCELLED;
            failedCancelParentIds.push(p.id);
            pendingDepsCount++;
          } else {
            // PROCEED: 부모 실패 무시. cascade 가 보냈을 감소를 접어 settled 로.
            settledParentIds.add(p.id);
          }
          continue;
        }
        // PENDING / IN_FLIGHT — 미완료 의존성으로 카운트
        pendingDepsCount++;
      }

      // 4. supersedeKey 가 있으면 같은 자리의 옛 행을 닫는다 — 큐 안에 자리당
      //    살아있는 값이 하나만 남는다 (절대값 set 의 큐 내부 역전 방지).
      if (req.supersedeKey) {
        this._supersedeScopeInTx(
          tx,
          req.supersedeKey,
          `superseded by newer enqueue: ${req.id}`,
          now,
        );
      }

      // 5. mutation + dependency 행 삽입
      tx.insert(outboxMutation)
        .values({
          id: req.id,
          type: req.type,
          payload: req.payload,
          status: initialStatus,
          attempts: 0,
          lastError: null,
          nextAttemptAt: now,
          pendingDepsCount,
          onDepFail,
          rootId,
          resolutionReason:
            failedCancelParentIds.length > 0
              ? `auto-cancelled at enqueue — parent terminal-failure: ${failedCancelParentIds.join(', ')}`
              : null,
          initialBackoffMs,
          maxBackoffMs,
          expiresAt,
          supersedeKey: req.supersedeKey ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const parentId of dependsOnUnique) {
        tx.insert(outboxDependency)
          .values({
            parentId,
            childId: req.id,
            settled: settledParentIds.has(parentId),
          })
          .run();
      }

      return {
        success: true as const,
        data: { id: req.id, rootId, deduplicated: false },
      };
    });
  }

  /** 스케줄러 즉시 1회 사이클 트리거. */
  async drain(): Promise<Result<DrainResult, OutboxCause>> {
    return notImplemented('drain');
  }

  /**
   * 특정 rootId 의 체인 스냅샷 1회 조회. 행은 `createdAt` ASC, 각 행의 `dependsOn` 은 join 테이블에서
   * parentId ASC 로 빌드한다. 매치 0개면 NOT_FOUND. status 필터는 없다 — 운영자 UI 용이다.
   */
  async getChain(
    req: GetChainRequest,
  ): Promise<Result<GetChainResult, OutboxCause>> {
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.rootId, req.rootId))
        .orderBy(asc(outboxMutation.createdAt))
        .all();

      if (rows.length === 0) {
        return {
          success: false as const,
          cause: 'NOT_FOUND' as const,
          code: OUTBOX_ERROR_CODE.NOT_FOUND,
        };
      }

      const childIds = rows.map((r) => r.id);
      const deps = tx
        .select()
        .from(outboxDependency)
        .where(inArray(outboxDependency.childId, childIds))
        .orderBy(asc(outboxDependency.parentId))
        .all();

      // childId → parentId[] (parentId ASC 정렬은 위 orderBy 가 보장)
      const depsByChild = new Map<string, string[]>();
      for (const d of deps) {
        const arr = depsByChild.get(d.childId) ?? [];
        arr.push(d.parentId);
        depsByChild.set(d.childId, arr);
      }

      const data = rows.map((r) => ({
        ...r,
        dependsOn: depsByChild.get(r.id) ?? [],
      }));

      return {
        success: true as const,
        data,
      };
    });
  }

  /**
   * 종결-실패 행을 다시 시도 (운영자 엔드포인트).
   *
   * - 진입 가능: DEAD / CANCELLED → PENDING
   * - 거부: PENDING / IN_FLIGHT / SUCCESS / RESOLVED_EXTERNAL → INVALID_STATE_TRANSITION
   * - 거부: EXPIRED(시효 지남) / SUPERSEDED(더 새 값이 대체) — 되살리는 것 자체가 사고다
   * - 미존재 → NOT_FOUND
   *
   * Target 행은 PENDING · attempts=0 · lastError/resolutionReason 클리어 · nextAttemptAt=now(즉시 ready),
   * createdAt 은 보존. cascade(기본 REACTIVATE)는 CANCELLED 후손을 BFS 로 PENDING 부활시키되
   * **자식 counter 는 절대 안 건드린다** — target 이 종결-성공이 아니라 자식 입장에선 여전히 미해결
   * 부모다(resolve 와의 핵심 차이).
   */
  async retry(req: RetryRequest): Promise<ResultVoid<OutboxCause>> {
    const now = this.clock();
    const cascade = req.cascade ?? CASCADE_POLICY.REACTIVATE;

    return this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, req.id))
        .get();

      if (!row) {
        return {
          success: false as const,
          cause: 'NOT_FOUND' as const,
          code: OUTBOX_ERROR_CODE.NOT_FOUND,
        };
      }

      if (
        row.status !== OUTBOX_STATUS.DEAD &&
        row.status !== OUTBOX_STATUS.CANCELLED
      ) {
        return {
          success: false as const,
          cause: 'INVALID_STATE_TRANSITION' as const,
          code: OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION,
        };
      }

      // target → PENDING + clean state
      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.PENDING,
          attempts: 0,
          lastError: null,
          resolutionReason: null,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(outboxMutation.id, req.id))
        .run();

      // 자식 counter 는 건드리지 않음 — target 이 PENDING 으로 가니 여전히 미해결.

      if (cascade === CASCADE_POLICY.REACTIVATE) {
        this._reactivateCancelledDescendantsInTx(tx, req.id, now);
      }

      return { success: true as const };
    });
  }

  /**
   * 트랜잭션 내부 헬퍼 — startId 의 후손 중 BFS 로 도달 가능한 CANCELLED 행을 PENDING 으로 부활시킨다
   * (resolve/retry 의 REACTIVATE 가 공유). CANCELLED 만 frontier 에 넣어 비-CANCELLED 를 만나면 멈추고,
   * status 만 바꾼다(counter / resolutionReason 보존).
   */
  private _reactivateCancelledDescendantsInTx(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    startId: string,
    now: number,
  ): void {
    let frontier: string[] = [startId];
    while (frontier.length > 0) {
      const childIdRows = tx
        .select({ childId: outboxDependency.childId })
        .from(outboxDependency)
        .where(inArray(outboxDependency.parentId, frontier))
        .all();
      if (childIdRows.length === 0) break;

      const uniqueChildIds = Array.from(
        new Set(childIdRows.map((r) => r.childId)),
      );
      const children = tx
        .select()
        .from(outboxMutation)
        .where(inArray(outboxMutation.id, uniqueChildIds))
        .all();

      const cancelledIds = children
        .filter((c) => c.status === OUTBOX_STATUS.CANCELLED)
        .map((c) => c.id);

      if (cancelledIds.length > 0) {
        tx.update(outboxMutation)
          .set({
            status: OUTBOX_STATUS.PENDING,
            updatedAt: now,
          })
          .where(inArray(outboxMutation.id, cancelledIds))
          .run();
      }

      frontier = cancelledIds;
    }
  }

  /**
   * 외부 경로로 비즈니스 완료 — 운영자 엔드포인트.
   *
   * - 진입 가능: PENDING / IN_FLIGHT / DEAD / CANCELLED → RESOLVED_EXTERNAL
   * - 거부: SUCCESS / RESOLVED_EXTERNAL → INVALID_STATE_TRANSITION · 미존재 → NOT_FOUND
   * - attempts / lastError 는 보존한다 — resolve 는 시도 결과가 아니다.
   *
   * cascade(기본 REACTIVATE): 공통으로 직접 자식들의 **미정산 엣지만** 정산 + pendingDepsCount--
   * (자식 status 무관). 정산 필터가 없으면 DEAD/EXPIRED 가 이미 감소시킨 PROCEED 자식을 또 감소시켜,
   * 부모 하나짜리 자식에선 CHECK 위반으로 resolve 자체가 영영 불가능해진다.
   * REACTIVATE 는 CANCELLED 후손을 BFS 로 PENDING 부활, LEAVE/CANCEL 은 counter 감소만 한다.
   */
  async resolve(req: ResolveRequest): Promise<ResultVoid<OutboxCause>> {
    const now = this.clock();
    const cascade = req.cascade ?? CASCADE_POLICY.REACTIVATE;

    return this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, req.id))
        .get();

      if (!row) {
        return {
          success: false as const,
          cause: 'NOT_FOUND' as const,
          code: OUTBOX_ERROR_CODE.NOT_FOUND,
        };
      }

      if (
        row.status === OUTBOX_STATUS.SUCCESS ||
        row.status === OUTBOX_STATUS.RESOLVED_EXTERNAL
      ) {
        return {
          success: false as const,
          cause: 'INVALID_STATE_TRANSITION' as const,
          code: OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION,
        };
      }

      // 1. target → RESOLVED_EXTERNAL + 운영자 reason
      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.RESOLVED_EXTERNAL,
          resolutionReason: req.reason,
          updatedAt: now,
        })
        .where(eq(outboxMutation.id, req.id))
        .run();

      // 2. 직접 자식들의 미정산 엣지 정산 + counter 감소 (cascade 옵션 무관)
      this._settleEdgesInTx(tx, req.id, now);

      // 3. REACTIVATE: CANCELLED 후손을 BFS 로 따라가며 PENDING 으로 부활
      if (cascade === CASCADE_POLICY.REACTIVATE) {
        this._reactivateCancelledDescendantsInTx(tx, req.id, now);
      }
      // LEAVE / CANCEL: 추가 작업 없음 (counter 감소는 이미 위에서 처리)

      return { success: true as const };
    });
  }

  /**
   * 비즈니스 작업 폐기 (운영자 엔드포인트).
   *
   * - 진입 가능: PENDING / IN_FLIGHT / DEAD → CANCELLED
   * - 종결 상태 → INVALID_STATE_TRANSITION. EXPIRED 를 폐기로 덮으면 "시효가 지났다"는 사실이
   *   지워지고, 이미 폐기된 것이라 덮을 이유도 없다(외부 처리였다면 resolve 가 그 자리다).
   * - 미존재 → NOT_FOUND
   *
   * cascade 는 onDepFail 을 **무시**한다 — 모든 비-종결 후손을 CANCELLED 로(operator override).
   * cascade 행의 resolutionReason 은 `auto-cascaded from cancel: <parentId>` 로 운영자 reason 과 구분한다.
   */
  async cancel(req: CancelRequest): Promise<ResultVoid<OutboxCause>> {
    const now = this.clock();

    return this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, req.id))
        .get();

      if (!row) {
        return {
          success: false as const,
          cause: 'NOT_FOUND' as const,
          code: OUTBOX_ERROR_CODE.NOT_FOUND,
        };
      }

      // DEAD 만 예외 — 서버가 거절한 건 운영자가 폐기로 종결지을 수 있다.
      if (isTerminalStatus(row.status) && row.status !== OUTBOX_STATUS.DEAD) {
        return {
          success: false as const,
          cause: 'INVALID_STATE_TRANSITION' as const,
          code: OUTBOX_ERROR_CODE.INVALID_STATE_TRANSITION,
        };
      }

      // 1. 대상 행 → CANCELLED + 운영자 reason
      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.CANCELLED,
          resolutionReason: req.reason,
          updatedAt: now,
        })
        .where(eq(outboxMutation.id, req.id))
        .run();

      // 2. cascade BFS — 모든 비-종결 후손을 CANCELLED 로
      const cascadeReason = `auto-cascaded from cancel: ${req.id}`;

      let frontier: string[] = [req.id];
      while (frontier.length > 0) {
        const childIdRows = tx
          .select({ childId: outboxDependency.childId })
          .from(outboxDependency)
          .where(inArray(outboxDependency.parentId, frontier))
          .all();
        if (childIdRows.length === 0) break;

        const uniqueChildIds = Array.from(
          new Set(childIdRows.map((r) => r.childId)),
        );
        const children = tx
          .select()
          .from(outboxMutation)
          .where(inArray(outboxMutation.id, uniqueChildIds))
          .all();

        const cancelIds = children
          .filter((c) => !isTerminalStatus(c.status))
          .map((c) => c.id);

        if (cancelIds.length > 0) {
          tx.update(outboxMutation)
            .set({
              status: OUTBOX_STATUS.CANCELLED,
              resolutionReason: cascadeReason,
              updatedAt: now,
            })
            .where(inArray(outboxMutation.id, cancelIds))
            .run();
        }

        // 다음 사이클: 방금 CANCELLED 된 자식들만 cascade 계속
        frontier = cancelIds;
      }

      return { success: true as const };
    });
  }

  /**
   * 같은 자리(supersedeKey)의 옛 행들을 SUPERSEDED 로 닫는다. 더 새 값이 **큐 밖**(직접 호출)에서
   * 확정됐을 때 프론트가 쏜다 — 큐 안의 역전은 enqueue 가 같은 헬퍼로 스스로 닫는다.
   * 매치 0건도 성공(superseded: 0) — 큐가 비어 있는 것이 정상 상태다.
   */
  async supersede(
    req: SupersedeRequest,
  ): Promise<Result<SupersedeResult, OutboxCause>> {
    const now = this.clock();

    return this.db.transaction((tx) => ({
      success: true as const,
      data: {
        superseded: this._supersedeScopeInTx(
          tx,
          req.supersedeKey,
          req.reason,
          now,
        ),
      },
    }));
  }

  /**
   * supersedeKey 가 같은 행들 중 다시 나갈 수 있는 것을 전부 SUPERSEDED 로 닫는다.
   *
   * - PENDING / IN_FLIGHT / DEAD / CANCELLED → SUPERSEDED
   *   - DEAD / CANCELLED 까지 닫는 이유: retry 로 되살릴 수 있는 상태다 — 낡은
   *     절대값의 부활이 정확히 막으려는 버그고, SUPERSEDED 는 retry 를 거부한다.
   *   - IN_FLIGHT 도 닫는다: 이미 나간 요청은 못 붙잡지만, 실패로 PENDING 에 돌아와
   *     다시 나가는 것은 막는다. 돌아온 verdict 는 IN_FLIGHT 가 아니므로 no-op.
   * - EXPIRED 는 보존 — 이미 부활 불가고, "시효가 지났다"는 사실을 덮을 이유가 없다.
   * - **비종결이던 행만** 후손 cascade — 종결 행은 그때 이미 전파했다.
   *
   * 반환: SUPERSEDED 로 닫힌 행 개수.
   */
  private _supersedeScopeInTx(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    supersedeKey: string,
    reason: string,
    now: number,
  ): number {
    const rows = tx
      .select()
      .from(outboxMutation)
      .where(
        and(
          eq(outboxMutation.supersedeKey, supersedeKey),
          inArray(outboxMutation.status, [
            OUTBOX_STATUS.PENDING,
            OUTBOX_STATUS.IN_FLIGHT,
            OUTBOX_STATUS.DEAD,
            OUTBOX_STATUS.CANCELLED,
          ]),
        ),
      )
      .all();

    if (rows.length === 0) return 0;

    tx.update(outboxMutation)
      .set({
        status: OUTBOX_STATUS.SUPERSEDED,
        resolutionReason: reason,
        updatedAt: now,
      })
      .where(
        inArray(
          outboxMutation.id,
          rows.map((r) => r.id),
        ),
      )
      .run();

    for (const row of rows) {
      if (isTerminalStatus(row.status)) continue; // DEAD/CANCELLED — 이미 전파됨
      this._cascadeTerminalFailureInTx(
        tx,
        row.id,
        `auto-cascaded from SUPERSEDED: ${row.id}`,
        now,
      );
    }

    return rows.length;
  }

  // 스케줄러가 호출하는 내부 작업

  /**
   * `status='PENDING' && pendingDepsCount=0 && nextAttemptAt <= now()` 인 행을 createdAt ASC(FIFO)로
   * 최대 limit 개 골라 IN_FLIGHT 로 마크하고 반환한다.
   *
   * 한 트랜잭션 안에서 select + update 가 함께 수행되므로 외부 동시 호출 시 같은 행이 두 번 픽업되지
   * 않는다. 음수 limit 같은 비정상 입력은 호출자(스케줄러) 책임이다.
   */
  async pickReady(limit: number): Promise<OutboxMutationRow[]> {
    const now = this.clock();

    return this.db.transaction((tx) => {
      const candidates = tx
        .select()
        .from(outboxMutation)
        .where(
          and(
            eq(outboxMutation.status, OUTBOX_STATUS.PENDING),
            eq(outboxMutation.pendingDepsCount, 0),
            lte(outboxMutation.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(outboxMutation.createdAt))
        .limit(limit)
        .all();

      if (candidates.length === 0) return [];

      const ids = candidates.map((r) => r.id);
      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.IN_FLIGHT,
          updatedAt: now,
        })
        .where(inArray(outboxMutation.id, ids))
        .run();

      return candidates.map((r) => ({
        ...r,
        status: OUTBOX_STATUS.IN_FLIGHT,
        updatedAt: now,
      }));
    });
  }

  /**
   * parentId 에서 나가는 **미정산 엣지**를 정산 마킹하고 그 자식들의 카운터를 1 감소한다.
   * (childIds 를 주면 그 자식들로 제한 — 종결-실패 cascade 의 PROCEED 갈래)
   *
   * 감소 신호를 보내는 세 곳(markSuccess / cascade / resolve)이 전부 이 헬퍼를 지나 "엣지당 정확히 1회
   * 감소"가 데이터로 강제된다 — 부모 status 에서 역산하던 방식은 DEAD→cancel→resolve 경로에서 이력이
   * 지워져 이중 감소가 났었다.
   */
  private _settleEdgesInTx(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    parentId: string,
    now: number,
    childIds?: string[],
  ): void {
    const unsettledChildIds = tx
      .select({ childId: outboxDependency.childId })
      .from(outboxDependency)
      .where(
        and(
          eq(outboxDependency.parentId, parentId),
          eq(outboxDependency.settled, false),
          childIds ? inArray(outboxDependency.childId, childIds) : undefined,
        ),
      )
      .all()
      .map((r) => r.childId);

    if (unsettledChildIds.length === 0) return;

    tx.update(outboxDependency)
      .set({ settled: true })
      .where(
        and(
          eq(outboxDependency.parentId, parentId),
          inArray(outboxDependency.childId, unsettledChildIds),
        ),
      )
      .run();

    tx.update(outboxMutation)
      .set({
        pendingDepsCount: sql`${outboxMutation.pendingDepsCount} - 1`,
        updatedAt: now,
      })
      .where(inArray(outboxMutation.id, unsettledChildIds))
      .run();
  }

  /**
   * 원격 호출 성공 처리. 부모는 IN_FLIGHT → SUCCESS.
   *
   * **직접 자식**의 미정산 엣지만 정산하고 카운터를 1 감소한다(손자는 안 건드린다 — 카운터 의미가
   * "직접 부모 중 미정산 엣지 수"다). 정산 필터가 있어야 DEAD(PROCEED 자식 정산됨)→retry→성공 경로가
   * 이중 감소를 내지 않는다. 자식 status 자체는 안 건드린다 — CANCELLED 여도 카운터만 일관 유지해야
   * 나중에 resolve(REACTIVATE)가 정확한 값에서 시작한다.
   *
   * 멱등성: 부모가 IN_FLIGHT 가 아니면 early return — 자식 카운터가 이중 감소되지 않는다.
   */
  async markSuccess(id: string): Promise<void> {
    const now = this.clock();

    this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, id))
        .get();

      if (!row || row.status !== OUTBOX_STATUS.IN_FLIGHT) return;

      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.SUCCESS,
          updatedAt: now,
          lastError: null,
        })
        .where(eq(outboxMutation.id, id))
        .run();

      this._settleEdgesInTx(tx, id, now);
    });
  }

  /**
   * 일시 실패 처리 (executor: transient_failure). 부모가 IN_FLIGHT 가 아니면 no-op(멱등성),
   * 맞으면 attempts++ · lastError 기록 · PENDING 으로 되돌리고 백오프 후 시점을 예약한다.
   *
   * **여기서 종결시키지 않는다.** 자동 종결은 기한(expiresAt)만 결정한다 — 횟수 상한을 함께 두면 종료
   * 조건이 둘이 되고, 재시도할 가치가 없는 실패는 executor 가 permanent_failure 로 이미 표현한다.
   *
   * 백오프 = `min(initial x 2^(attempts-1), max) x jitter` (cap 적용 후 jitter, 기본 ±25%).
   * 자식 카운터는 건드리지 않는다 — 재시도 진행 중이라 의존성 의미가 그대로다.
   */
  async markFailure(id: string, error: string): Promise<void> {
    const now = this.clock();

    this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, id))
        .get();

      if (!row || row.status !== OUTBOX_STATUS.IN_FLIGHT) return;

      const newAttempts = row.attempts + 1;

      // 지수 백오프 + jitter
      const baseMs = Math.min(
        row.initialBackoffMs * 2 ** (newAttempts - 1),
        row.maxBackoffMs,
      );
      const jitter = DEFAULT_RETRY_POLICY.JITTER_RATIO;
      const jitterFactor = 1 - jitter + 2 * jitter * this.random();
      const backoffMs = Math.floor(baseMs * jitterFactor);

      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.PENDING,
          attempts: newAttempts,
          lastError: error,
          nextAttemptAt: now + backoffMs,
          updatedAt: now,
        })
        .where(eq(outboxMutation.id, id))
        .run();
    });
  }

  /**
   * 도달 실패 처리 (executor: deferred).
   *
   * markFailure 와 갈리는 축은 하나 — **시도를 세지 않는다.** 오프라인·토큰 부재는 서버가 거절한 게
   * 아니라 묻지도 못한 것이라, 시도로 세면 세 시간 끊긴 회선이 큐 전체를 DEAD 로 만든다.
   *
   * attempts / lastError / resolutionReason 을 보존한다 — 특히 lastError 를 defer 사유로 덮으면 직전
   * 서버 에러가 지워진다(오프라인은 행마다 다른 사실이 아니라 프로세스 전체의 사실이라 로그가 맞는 자리다).
   */
  async markDeferred(id: string): Promise<void> {
    const now = this.clock();

    this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, id))
        .get();

      if (!row || row.status !== OUTBOX_STATUS.IN_FLIGHT) return;

      const jitter = DEFAULT_RETRY_POLICY.JITTER_RATIO;
      const jitterFactor = 1 - jitter + 2 * jitter * this.random();
      const waitMs = Math.floor(
        DEFAULT_RETRY_POLICY.DEFERRED_RETRY_MS * jitterFactor,
      );

      tx.update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.PENDING,
          nextAttemptAt: now + waitMs,
          updatedAt: now,
        })
        .where(eq(outboxMutation.id, id))
        .run();
    });
  }

  /**
   * 영구 실패 처리 (executor: permanent_failure). 부모는 DEAD 로 가고 후손에 onDepFail 정책을 BFS 로
   * 전파한다 — CANCEL 자식은 CANCELLED + 손자 재귀, PROCEED 자식은 pendingDepsCount-- 만(자식이
   * terminal 이 아니라 cascade 는 멈춘다). 이미 종결 상태인 자식은 건드리지 않는다.
   */
  async markDead(id: string, error: string): Promise<void> {
    const now = this.clock();

    this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(outboxMutation)
        .where(eq(outboxMutation.id, id))
        .get();

      if (!row || row.status !== OUTBOX_STATUS.IN_FLIGHT) return;

      this._transitionToDeadInTx(tx, row, error, now);
    });
  }

  /** 부모를 DEAD 로 전이하고 후손에 cascade 를 적용한다(트랜잭션 내부). 호출자가 IN_FLIGHT 를 확인한 뒤 부른다. */
  private _transitionToDeadInTx(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    row: OutboxMutationRow,
    error: string,
    now: number,
  ): void {
    // 1. 부모 행 → DEAD
    tx.update(outboxMutation)
      .set({
        status: OUTBOX_STATUS.DEAD,
        attempts: row.attempts + 1,
        lastError: error,
        updatedAt: now,
      })
      .where(eq(outboxMutation.id, row.id))
      .run();

    this._cascadeTerminalFailureInTx(
      tx,
      row.id,
      `auto-cascaded from DEAD: ${row.id}`,
      now,
    );
  }

  /**
   * 종결-실패한 부모의 후손에 onDepFail 정책을 BFS 로 전파한다.
   * DEAD 와 EXPIRED 가 공유한다 — 자식 입장에선 "부모가 끝내 이뤄지지 않았다"로 같다.
   */
  private _cascadeTerminalFailureInTx(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    startId: string,
    cascadeReason: string,
    now: number,
  ): void {
    // frontier = "이번 사이클에 자식들에게 cascade 신호를 보낼 부모들"
    // 처음엔 방금 종결된 행, 다음엔 cascade 로 CANCELLED 된 자식들이 frontier 가 됨.
    // PROCEED 자식은 terminal 이 아니므로 frontier 에 들어가지 않음 (cascade 멈춤).
    let frontier: string[] = [startId];
    while (frontier.length > 0) {
      const childIdRows = tx
        .select({ childId: outboxDependency.childId })
        .from(outboxDependency)
        .where(inArray(outboxDependency.parentId, frontier))
        .all();
      if (childIdRows.length === 0) break;

      const uniqueChildIds = Array.from(
        new Set(childIdRows.map((r) => r.childId)),
      );
      const children = tx
        .select()
        .from(outboxMutation)
        .where(inArray(outboxMutation.id, uniqueChildIds))
        .all();

      const cancelIds: string[] = [];
      const proceedIds: string[] = [];

      for (const c of children) {
        if (isTerminalStatus(c.status)) continue; // 이미 종결 — 무시
        if (c.onDepFail === ON_DEP_FAIL.CANCEL) {
          cancelIds.push(c.id);
        } else if (c.onDepFail === ON_DEP_FAIL.PROCEED) {
          proceedIds.push(c.id);
        }
      }

      if (cancelIds.length > 0) {
        tx.update(outboxMutation)
          .set({
            status: OUTBOX_STATUS.CANCELLED,
            resolutionReason: cascadeReason,
            updatedAt: now,
          })
          .where(inArray(outboxMutation.id, cancelIds))
          .run();
      }

      if (proceedIds.length > 0) {
        // 엣지 단위로 정산한다 — frontier 의 부모 둘이 같은 PROCEED 자식을 가리키면
        // 엣지가 둘이므로 두 번 감소해야 한다(집합으로 한 번만 빼면 카운터가 샌다).
        for (const parentId of frontier) {
          this._settleEdgesInTx(tx, parentId, now, proceedIds);
        }
      }

      // 다음 사이클: CANCELLED 된 자식들만 cascade 계속.
      // PROCEED 자식은 terminal-failure 가 아니므로 그 자식들에 신호 안 보냄.
      frontier = cancelIds;
    }
  }

  // 부팅 복구

  /**
   * 부팅 시 IN_FLIGHT 였던 행을 PENDING 으로 리셋한다. 사이드카가 비정상 종료되면 picker 로 클레임됐던
   * 행이 IN_FLIGHT 로 멈추는데, 되돌리면 다음 picker 사이클이 다시 잡는다(서버 멱등성 전제).
   *
   * nextAttemptAt = now(즉시 ready). attempts / lastError / createdAt 은 보존한다 — 클린 리셋이지
   * 시도 결과가 아니다. 자식 카운터와 의존성 row 는 건드리지 않는다.
   */
  async resetInFlight(): Promise<number> {
    const now = this.clock();

    return this.db.transaction((tx) => {
      const updated = tx
        .update(outboxMutation)
        .set({
          status: OUTBOX_STATUS.PENDING,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(outboxMutation.status, OUTBOX_STATUS.IN_FLIGHT))
        .returning({ id: outboxMutation.id })
        .all();

      return updated.length;
    });
  }

  // 기한

  /**
   * 유효기간이 지난 PENDING 행을 EXPIRED 로 종결하고 후손에 cascade 한다.
   * 스케줄러가 매 사이클 픽업 **직전**에 호출한다.
   *
   * - 대상: `status=PENDING && expiresAt != null && expiresAt < now`
   *   (경계 포함 — `expiresAt === now` 는 아직 유효하다)
   * - `IN_FLIGHT` 는 건드리지 않는다: 이미 나간 요청은 끝까지 보고, 실패로 PENDING 에
   *   돌아오면 다음 사이클이 잡는다. 중간에 뺏으면 결과를 모르는 채 종결된다.
   * - 의존성 대기 중이어도 만료된다 — 부모를 기다리다 기한이 지난 것도 만료다.
   * - attempts / lastError 보존. 만료는 시도가 아니라 시계가 지난 것이다.
   * - 후손 처리는 DEAD 와 동일하다 — 자식 입장에선 "부모가 끝내 이뤄지지 않았다"로 같다.
   *
   * 반환: 만료된 행 개수.
   */
  async expireOverdue(): Promise<number> {
    const now = this.clock();

    return this.db.transaction((tx) => {
      const overdue = tx
        .select()
        .from(outboxMutation)
        .where(
          and(
            eq(outboxMutation.status, OUTBOX_STATUS.PENDING),
            isNotNull(outboxMutation.expiresAt),
            lt(outboxMutation.expiresAt, now),
          ),
        )
        .all();

      for (const row of overdue) {
        tx.update(outboxMutation)
          .set({
            status: OUTBOX_STATUS.EXPIRED,
            resolutionReason: `expired at ${new Date(now).toISOString()}`,
            updatedAt: now,
          })
          .where(eq(outboxMutation.id, row.id))
          .run();

        this._cascadeTerminalFailureInTx(
          tx,
          row.id,
          `auto-cascaded from EXPIRED: ${row.id}`,
          now,
        );
      }

      return overdue.length;
    });
  }
}
