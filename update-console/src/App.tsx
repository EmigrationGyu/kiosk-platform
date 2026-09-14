import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  fetchAllKiosks,
  fetchMoreKiosks,
  fetchScope,
  sendRollbackCommand,
  signIn,
} from './api';
import { ComponentPicker, type Picks, type Zoom } from './ComponentPicker';
import { DescriptionBox } from './DescriptionBox';
import { dispatch, failedIds, type Result } from './dispatch';
import { fillLatest } from './fill';
import {
  createFleet,
  type Deployment,
  healthOf,
  type KioskHealth,
  matchesTargetFilter,
  TARGET_FILTER,
  type TargetFilter,
  type Tier,
  type TierAssignment,
} from './fleet';
import { HistoryPane } from './history/HistoryPane';
import { KioskTree } from './KioskTree';
import { type Mode, manifestBody } from './manifest';
import { Splitter } from './Splitter';
import { StateMatrix } from './StateMatrix';
import { loadVersions } from './s3';
import {
  recoverBatchId,
  summarizeBatch,
  toComponents,
  unfinishedKiosks,
} from './send/batch';
import { ResultsPane } from './send/ResultsPane';
import { SendPane } from './send/SendPane';
import { type GroupAxis, TargetFilters } from './TargetFilters';
import { TierPane } from './tier/TierPane';
import type {
  ArtifactDescriptor,
  HostKey,
  Kiosk,
  Scope,
  Target,
  UpdateComponent,
} from './types';
import {
  BASE_TARGET,
  bakedAtOf,
  COMPONENTS,
  labelOf,
  surfaceOf,
  UPDATE_COMPONENT,
} from './types';
import { useColumnWidths } from './useColumnWidths';
import { VersionDetail } from './VersionDetail';
import './app.css';

/**
 * 발송 진행을 다시 묻는 간격 — **점점 뜸해진다.**
 *
 * 적용은 홈 진입 드레인이라 손님이 쓰는 중이면 몇 분이 걸린다. 촘촘히 물어도 빨라지지
 * 않으므로, 처음엔 반응이 있게 짧게 묻고 답이 안 오면 간격을 벌린다.
 */
const POLL_STEPS_MS = [5_000, 5_000, 10_000, 20_000, 30_000] as const;
const pollDelay = (tick: number): number =>
  POLL_STEPS_MS[Math.min(tick, POLL_STEPS_MS.length - 1)] ?? 30_000;

/**
 * 이만큼 물어도 결론이 안 나면 그만둔다.
 *
 * 영영 답하지 않는 기기가 실제로 있다(옛 펌웨어·폐기된 단말). 멈추지 않으면 열어둔 탭
 * 하나가 밤새 수천 번을 묻는다 — 배포 한 번 때문에. 남은 것은 이력에서 보고 닫는다.
 */
const POLL_BUDGET_MS = 10 * 60_000;

/**
 * 관리자 전용 조회가 막혔을 때의 안내.
 *
 * 배포 실행·티어·이력은 서버가 ADMIN 으로 잠근다. 그런데 키오스크 목록을 주는
 * `searchKiosks` 는 같은 잠금을 **강제하지 않아서**(가드의 반환값을 버린다) 로그인만 하면
 * 목록이 보인다. 그래서 "목록이 보이니 관리자겠지"가 거짓이 될 수 있고, 그 상태로 배포를
 * 누르면 그때서야 UNAUTHORIZED 가 뜬다 — 원인을 여기서 말해준다.
 */
const describeAdminFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes('UNAUTHORIZED')
    ? `${message} — 이 계정에는 배포 권한(ADMIN)이 없습니다. 키오스크 목록이 보이는 것과는 별개입니다.`
    : message;
};

/** 화면에 그릴 키오스크를 한 줄로 편다 - 관리자/업장 두 모양을 하나로 만든다. */
const flatten = (scope: Scope | null): Kiosk[] =>
  scope === null
    ? []
    : scope.kind === 'admin'
      ? scope.kiosks
      : scope.accommodations.flatMap((accommodation) =>
          accommodation.kiosks.map((kiosk) => ({
            ...kiosk,
            accommodationName: accommodation.name,
          })),
        );

export function App() {
  const [host, setHost] = useState<HostKey>('staging');
  const [token, setToken] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [picks, setPicks] = useState<Picks>({});
  // 컴포넌트 조합과 앱 전체 설치는 함께 보낼 수 없다 — 화면도 둘 중 하나만 고르게 한다.
  const [mode, setMode] = useState<Mode>('components');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [unfilled, setUnfilled] = useState<UpdateComponent[]>([]);
  /** 최신으로 채울 때 기준이 된 계약 — 무엇에 맞춰 채웠는지 보이지 않으면 판단할 수 없다. */
  const [fillBaseline, setFillBaseline] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  /**
   * 배경 조회가 막힌 이유 — 발송 에러와 **따로 든다.**
   *
   * 둘을 한 자리에 쓰면 "UNAUTHORIZED" 가 떴을 때 그게 불러오다 난 것인지 보내다 난
   * 것인지 알 수 없다(실측: 그래서 원인을 서버 코드까지 가서 찾았다).
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 인스펙터가 무엇을 비추는가 — 마지막으로 고른 컴포넌트. */
  const [focused, setFocused] = useState<Target | null>(null);
  /** 확대해서 보는 중인 버전. */
  const [zoom, setZoom] = useState<Zoom | null>(null);
  /** 결과 열이 무엇의 결과인가 — 적용과 롤백은 같은 결과 열을 쓴다. */
  const [lastAction, setLastAction] = useState<'apply' | 'rollback'>('apply');
  /**
   * 마지막 발송의 id — 진행을 여기서 다시 묻는다.
   *
   * 적용은 **접수가 끝이 아니다.** 서버가 행을 만들고 키오스크가 홈에서 한가할 때 적용해
   * 결과를 보고하므로, 결과 열은 뮤테이션 응답이 아니라 그 행들의 status 를 그려야 한다.
   * (롤백은 서버에 행이 없어 예전처럼 접수까지만 안다.)
   */
  const [batchId, setBatchId] = useState<string | null>(null);
  /**
   * 발송의 행이 쪽 상한에 잘렸는가.
   *
   * 수백 대 × 여러 컴포넌트면 행이 상한을 넘는다. 그때 아래 집계는 **일부만** 센 값이라,
   * 잘렸다는 사실을 말하지 않으면 진행률이 조용히 거짓이 된다.
   */
  const [batchTruncated, setBatchTruncated] = useState(false);
  /** 기다리기를 그만뒀는가 — 영영 답하지 않는 기기가 있다는 뜻이다. */
  const [pollGaveUp, setPollGaveUp] = useState(false);
  /** 조합 열을 좁히는 것 둘 — 이름 검색과 "고른 것만". 컴포넌트가 스물까지 늘면 필요하다. */
  const [componentQuery, setComponentQuery] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  /**
   * 아직 안 끝난 지시 — 실패했거나 결론이 없는 것들.
   *
   * 실재(`Kiosk.versions`)와 다른 축이다. 실재는 키오스크 목록에 함께 실려 오고(배치로
   * 가져올 경로가 그것뿐이다), 이쪽은 따로 묻는다.
   */
  const [openDeployments, setOpenDeployments] = useState<readonly Deployment[]>(
    [],
  );
  const [tiers, setTiers] = useState<readonly Tier[]>([]);
  const [assignment, setAssignment] = useState<TierAssignment>({});
  const [filter, setFilter] = useState<TargetFilter>(TARGET_FILTER.ALL);
  const [axis, setAxis] = useState<GroupAxis>('accommodation');
  /** 버전 현황 판 — 여러 대의 실재를 세로로 비교하는 자리. */
  const [showMatrix, setShowMatrix] = useState(false);
  /** 티어 관리 화면이 열려 있는가. */
  const [showTiers, setShowTiers] = useState(false);
  /** 배포 이력 — 발송 단위로 접어 본다. 열 때 처음 불러온다(평소엔 안 긁는다). */
  const [history, setHistory] = useState<{
    rows: readonly Deployment[];
    cursor: string | null;
  } | null>(null);
  const { widths, set: setWidth, reset: resetWidths } = useColumnWidths();

  const kiosks = useMemo(() => flatten(scope), [scope]);
  const byId = useMemo(
    () => new Map(kiosks.map((kiosk) => [kiosk.id, kiosk])),
    [kiosks],
  );

  /**
   * 열린 지시와 티어를 불러온다 — 로그인 뒤 한 번.
   *
   * 실패해도 화면을 막지 않는다. 지시를 모르는 것은 **배포를 못 하는 이유가 아니다** —
   * 모르면 판정이 비고, 그것도 읽을 수 있는 상태다.
   *
   * 키오스크 목록에 딸려 오지 않는 것만 여기서 묻는다(실재는 목록이 이미 들고 있다).
   */
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const fleet = createFleet(host, token);
    void Promise.all([fleet.openDeployments(), fleet.tiers()])
      .then(([deployments, tierData]) => {
        if (!alive) return;
        setOpenDeployments(deployments);
        setTiers(tierData.tiers);
        setAssignment(tierData.assignment);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setLoadError(describeAdminFailure(cause));
      });
    return () => {
      alive = false;
    };
  }, [host, token]);

  const deploymentsByKiosk = useMemo(() => {
    const byKiosk = new Map<string, Deployment[]>();
    for (const deployment of openDeployments) {
      const found = byKiosk.get(deployment.kioskId);
      if (found) found.push(deployment);
      else byKiosk.set(deployment.kioskId, [deployment]);
    }
    return byKiosk;
  }, [openDeployments]);

  const deploymentsOf = useMemo(
    () => (kioskId: string) => deploymentsByKiosk.get(kioskId) ?? [],
    [deploymentsByKiosk],
  );

  /**
   * 발송의 진행을 다시 묻는다 — 적용은 접수가 끝이 아니다.
   *
   * 키오스크는 홈에서 한가할 때 적용하고 그때 결과를 보고하므로, 결과가 오는 데 몇 분이
   * 걸릴 수 있다. 다 끝나면 스스로 멈춘다 — 끝난 발송을 계속 묻는 것은 서버만 괴롭힌다.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: results 는 이 효과가 쓰는 것이 아니라 만드는 것이다
  useEffect(() => {
    if (!token || batchId === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tick = 0;
    const startedAt = Date.now();
    const fleet = createFleet(host, token);

    const poll = async () => {
      const page = await fleet.batch(batchId);
      if (!alive) return;
      setResults(summarizeBatch(page.rows));
      // 서버가 센 값과 불러온 행 수가 다르면 잘린 것이다.
      setBatchTruncated(page.total > page.rows.length);

      if (!page.rows.some((row) => row.status === 'SENT')) {
        setPollGaveUp(false);
        // 결론이 다 났다 — 대상 열의 판정도 이제 갱신돼야 한다.
        const open = await fleet.openDeployments();
        if (alive) setOpenDeployments(open);
        return;
      }

      if (Date.now() - startedAt > POLL_BUDGET_MS) {
        setPollGaveUp(true);
        return;
      }
      tick += 1;
      timer = setTimeout(
        () => void poll().catch(() => undefined),
        pollDelay(tick),
      );
    };

    setPollGaveUp(false);
    timer = setTimeout(
      () => void poll().catch(() => undefined),
      pollDelay(tick),
    );
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [host, token, batchId]);

  const now = Date.now();
  const healths = useMemo(
    () =>
      new Map<string, KioskHealth>(
        kiosks.map((kiosk) => [
          kiosk.id,
          healthOf(kiosk.versions, deploymentsOf(kiosk.id), now),
        ]),
      ),
    // now 는 렌더마다 갈리지만 판정 창이 분 단위라 값이 흔들리지 않는다.
    [kiosks, deploymentsOf, now],
  );

  const tierById = useMemo(
    () => new Map(tiers.map((tier) => [tier.id, tier])),
    [tiers],
  );
  /** 중복 소속이 허용된다 — 한 업장이 여러 티어에 속할 수 있다. */
  const tiersOf = useMemo(
    () => (kiosk: Kiosk) => {
      const id = kiosk.accommodationId;
      if (!id) return [];
      return (assignment[id] ?? [])
        .map((tierId) => tierById.get(tierId))
        .filter((tier): tier is Tier => tier !== undefined);
    },
    [tierById, assignment],
  );

  /** 화면이 아는 업장 — 불러온 키오스크에서 나온다. 티어 매기의 재료다. */
  const accommodations = useMemo(() => {
    const byId = new Map<string, string>();
    for (const kiosk of kiosks) {
      if (kiosk.accommodationId) {
        byId.set(kiosk.accommodationId, kiosk.accommodationName ?? '업장 미상');
      }
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [kiosks]);

  const counts = useMemo(() => {
    const out = {
      all: 0,
      connected: 0,
      offline: 0,
      trouble: 0,
      silent: 0,
    } as Record<TargetFilter, number>;
    for (const kiosk of kiosks) {
      const health = healths.get(kiosk.id);
      if (!health) continue;
      for (const key of Object.keys(out) as TargetFilter[]) {
        if (matchesTargetFilter(key, kiosk.connectionState, health)) {
          out[key] += 1;
        }
      }
    }
    return out;
  }, [kiosks, healths]);

  const visible = useMemo(
    () =>
      kiosks.filter((kiosk) => {
        const health = healths.get(kiosk.id);
        return health
          ? matchesTargetFilter(filter, kiosk.connectionState, health)
          : true;
      }),
    [kiosks, healths, filter],
  );

  const targets: readonly Target[] =
    mode === 'base' ? [BASE_TARGET] : COMPONENTS;
  const picked = Object.keys(picks).length;

  /** 모드를 바꾸면 고른 것을 버린다 — 다른 축의 선택은 서로 뜻이 없다. */
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setPicks({});
    setUnfilled([]);
    setFillBaseline(undefined);
    setFocused(null);
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(describeAdminFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const next = await signIn(
        host,
        String(form.get('identity')),
        String(form.get('password')),
      );
      setScope(await fetchScope(host, next));
      setToken(next);
    });
  };

  /** 고른 백엔드(없으면 최신 백엔드)와 말이 통하는 최신으로 나머지를 채운다. */
  const onFill = () =>
    void run(async () => {
      const {
        picks: filled,
        missing,
        baseline,
      } = await fillLatest({
        components: COMPONENTS,
        picks,
        load: async (component, reference) =>
          (
            await loadVersions({
              target: component,
              host,
              reference,
              size: 1,
            })
          ).items[0],
      });
      setPicks(filled);
      setUnfilled(missing);
      setFillBaseline(baseline?.version);
      setFocused(UPDATE_COMPONENT.BACKEND);
    });

  const onPick = (target: Target, chosen?: ArtifactDescriptor) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (chosen) next[target] = chosen;
      else delete next[target];
      return next;
    });
    if (chosen) setFocused(target);
    setZoom((prev) => (prev && prev.target === target ? null : prev));
  };

  const clearPicks = () => {
    setPicks({});
    setUnfilled([]);
    setFillBaseline(undefined);
    setFocused(null);
  };

  /**
   * 발송 한 번 — 부분 실패도 손에 쥔다.
   *
   * 대상이 100 대를 넘으면 서버가 청크로 커밋한다. 중간에 끊기면 앞 청크는 **이미
   * 나갔고**, 서버가 batchId 를 메시지에 담아 던진다. 그 id 를 잡아두지 않으면 이미 나간
   * 지시들을 아무도 못 보고 못 닫는다 — 에러는 그대로 올려보내되 진행은 볼 수 있게 한다.
   */
  const sendBatch = async (
    kioskIds: readonly string[],
    components: ReturnType<typeof toComponents>,
  ) => {
    if (!token) throw new Error('로그인이 필요합니다');
    try {
      return await createFleet(host, token).requestDeployment({
        kioskIds,
        components,
      });
    } catch (cause) {
      const partial = recoverBatchId(cause);
      if (partial) setBatchId(partial);
      throw cause;
    }
  };

  /**
   * 적용 — **대상 N 개를 한 호출로** 보낸다.
   *
   * 키오스크마다 쏘던 것과 다르다: 서버가 한 트랜잭션에서 행을 만들고 하나의 batchId 로
   * 묶으므로 발송 단계에 부분 성공이라는 중간 상태가 없다. 그래서 진행률도 여기서 세지
   * 않고 그 행들을 다시 물어 그린다.
   */
  const send = (kioskIds: readonly string[]) => {
    if (!token) return;
    const body = manifestBody(mode, picks);
    if (body === null) {
      setError(
        mode === 'base' ? '보낼 버전이 없습니다' : '보낼 컴포넌트가 없습니다',
      );
      return;
    }
    if (kioskIds.length === 0) {
      setError('보낼 대상이 없습니다');
      return;
    }
    setLastAction('apply');
    void run(async () => {
      const batch = await sendBatch(kioskIds, toComponents(body));
      setBatchId(batch.batchId);
      setBatchTruncated(false);
      setResults(summarizeBatch(batch.deployments));
    });
  };

  /** 롤백 — 목적지는 각 키오스크의 되돌림 스택이 안다. 확인 단계를 거친 뒤에만 온다. */
  const sendRollback = (kioskIds: readonly string[]) => {
    if (!token) return;
    setLastAction('rollback');
    // 롤백은 서버에 행이 없다 — 진행을 물을 곳도 없으므로 폴링을 끈다.
    setBatchId(null);
    void run(async () => {
      await dispatch(
        kioskIds,
        (id) => sendRollbackCommand(host, token, id),
        setResults,
      );
    });
  };

  /**
   * 끝나지 않은 것만 다시 — 마지막에 보낸 것과 같은 종류로.
   *
   * 적용은 실패뿐 아니라 **결론이 안 온 것도** 다시 보낸다. 새 지시가 옛 것을 덮으므로
   * (서버가 supersede 한다) 두 번 적용되지 않는다. 롤백은 접수 실패만 알 수 있다.
   */
  const retryFailed = () => {
    if (!results) return;
    const ids =
      lastAction === 'apply'
        ? results.filter((result) => result.status !== 'ok').map((r) => r.id)
        : failedIds(results);
    if (lastAction === 'rollback') sendRollback(ids);
    else send(ids);
  };

  /**
   * 전체 배포 — 서버를 끝까지 넘겨 대상을 잡는다. 화면에 불러온 목록은 검색·페이징으로
   * 좁혀져 있어 "전체"가 아니다. 서버 이름 입력을 통과한 뒤에만 온다.
   */
  const sendAll = () => {
    if (!token) return;
    const body = manifestBody(mode, picks);
    if (body === null) {
      setError('보낼 것이 없습니다');
      return;
    }
    setLastAction('apply');
    void run(async () => {
      const all = await fetchAllKiosks(host, token);
      // 결과 열이 이름을 찾을 수 있게 목록도 전부로 바꾼다.
      setScope({ kind: 'admin', kiosks: all, total: all.length, after: null });
      const batch = await sendBatch(
        all.map((kiosk) => kiosk.id),
        toComponents(body),
      );
      setBatchId(batch.batchId);
      setBatchTruncated(false);
      setResults(summarizeBatch(batch.deployments));
    });
  };

  /** 티어 목록을 다시 읽는다 — 만들고 지우고 매고 푼 뒤. */
  const reloadTiers = async () => {
    if (!token) return;
    const data = await createFleet(host, token).tiers();
    setTiers(data.tiers);
    setAssignment(data.assignment);
  };

  /** 티어를 고친다. 모든 쓰기가 같은 자리를 지나 목록 갱신까지 한 번에 간다. */
  const editTiers = (
    change: (fleet: ReturnType<typeof createFleet>) => Promise<void>,
  ) => {
    if (!token) return;
    void run(async () => {
      await change(createFleet(host, token));
      await reloadTiers();
    });
  };

  /**
   * 티어로 배포한다 — **대상을 미리 펼치지 않는다.**
   *
   * 서버가 발송 시점에 펼쳐야 그 사이 새로 설치된 키오스크가 자동으로 포함된다. 화면이
   * 지금 목록을 펼쳐 기기 id 로 보내면 그 자동 포함이 사라진다.
   */
  const deployTier = (tier: Tier) => {
    if (!token) return;
    const body = manifestBody(mode, picks);
    if (body === null) {
      setError('보낼 컴포넌트가 없습니다');
      return;
    }
    setLastAction('apply');
    setShowTiers(false);
    void run(async () => {
      const batch = await createFleet(host, token).requestDeployment({
        tierId: tier.id,
        components: toComponents(body),
      });
      setBatchId(batch.batchId);
      setBatchTruncated(false);
      setResults(summarizeBatch(batch.deployments));
    });
  };

  /**
   * 이력을 연다 / 더 불러온다.
   *
   * 평소에는 안 긁는다 — 이력은 화면을 열었을 때만 필요한 값이고, 대상 열의 판정은 열린
   * 지시(`openDeployments`)만 보면 된다.
   */
  const loadHistory = (cursor?: string) => {
    if (!token) return;
    void run(async () => {
      const page = await createFleet(host, token).history(cursor);
      setHistory((prev) => ({
        rows: cursor && prev ? [...prev.rows, ...page.rows] : page.rows,
        cursor: page.cursor,
      }));
    });
  };

  /**
   * 결론이 오지 않는 행을 닫는다.
   *
   * 옛 펌웨어 기기나 폐기된 키오스크는 영영 답하지 않는다. 닫지 않으면 판정이 계속
   * "이상"으로 잡아 진짜 문제를 덮는다. 닫은 뒤 이력과 열린 지시를 다시 읽는다.
   */
  const cancelDeployments = (rows: readonly Deployment[]) => {
    if (!token || rows.length === 0) return;
    void run(async () => {
      const fleet = createFleet(host, token);
      for (const row of rows) await fleet.cancel(row.id);
      const [page, open] = await Promise.all([
        fleet.history(),
        fleet.openDeployments(),
      ]);
      setHistory({ rows: page.rows, cursor: page.cursor });
      setOpenDeployments(open);
    });
  };

  /** 다음 페이지를 붙인다 — 관리자 조회에서만. */
  const loadMore = () => {
    if (!token || scope?.kind !== 'admin' || scope.after === null) return;
    const cursor = scope.after;
    void run(async () => {
      const more = await fetchMoreKiosks(host, token, keyword, cursor);
      setScope({
        ...scope,
        kiosks: [...scope.kiosks, ...more.kiosks],
        after: more.after,
      });
    });
  };

  if (!token) {
    return (
      <main className="login">
        <h1>키오스크 업데이트 콘솔</h1>
        <form onSubmit={onLogin}>
          <label>
            서버
            <select
              value={host}
              onChange={(event) => setHost(event.target.value as HostKey)}
            >
              <option value="staging">staging</option>
              <option value="development">development</option>
            </select>
          </label>
          <label>
            계정
            <input name="identity" autoComplete="username" required />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? '확인 중...' : '로그인'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="note">
          토큰은 메모리에만 둡니다. 새로고침하면 다시 로그인해야 합니다.
        </p>
      </main>
    );
  }

  const total = scope?.kind === 'admin' ? scope.total : kiosks.length;

  const focusTarget =
    focused ?? targets.find((target) => picks[target]) ?? null;
  const focusPick = focusTarget ? picks[focusTarget] : undefined;
  const baseline = picks[UPDATE_COMPONENT.BACKEND];

  return (
    <div className="app">
      <header className="top">
        <h1>업데이트 콘솔</h1>
        <span className="where mono">
          {host}
          <i> / </i>
          {scope?.kind === 'admin' ? 'admin' : 'member'}
          <i> / </i>
          {total} kiosks
        </span>
        <span className="spacer" />
        {scope?.kind === 'admin' && (
          <div className="modes">
            <button
              type="button"
              className={mode === 'components' ? 'mode is-on' : 'mode'}
              onClick={() => switchMode('components')}
            >
              컴포넌트 조합
            </button>
            <button
              type="button"
              className={mode === 'base' ? 'mode is-on' : 'mode'}
              onClick={() => switchMode('base')}
            >
              앱 전체
            </button>
          </div>
        )}
      </header>

      <div
        className="cols"
        style={
          {
            '--col-left': `${widths.left}px`,
            '--col-right': `${widths.right}px`,
          } as CSSProperties
        }
      >
        {/* ── 1. 대상 ───────────────────────────────────────────── */}
        <section className="pane">
          <div className="pane-head">
            <h2 className="pane-title">대상</h2>
            <span className="pane-count">{selected.size}</span>
            <span className="spacer" />
            {/* 툴팁으로 한 대씩 읽는 것으로는 비교가 안 된다 — 판으로 펼친다. */}
            <button
              type="button"
              onClick={() => setShowMatrix(true)}
              disabled={kiosks.length === 0}
            >
              버전 현황
            </button>
            <button type="button" onClick={() => loadHistory()} disabled={busy}>
              이력
            </button>
            {scope?.kind === 'admin' && (
              <button
                type="button"
                onClick={() => setShowTiers(true)}
                disabled={busy}
              >
                티어
              </button>
            )}
            {/* "전체" 선택은 없다 — 전체 배포는 보내기 열의 별도 관문으로만 나간다. */}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              해제
            </button>
          </div>

          {scope?.kind === 'admin' && (
            <div className="search">
              <input
                placeholder="키오스크 · 업장 이름으로 검색 (Enter)"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !token) return;
                  void run(async () =>
                    setScope(await fetchScope(host, token, keyword)),
                  );
                }}
              />
            </div>
          )}

          <TargetFilters
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            axis={axis}
            onAxis={setAxis}
            selected={selected.size}
          />

          <KioskTree
            kiosks={visible}
            selected={selected}
            onChange={setSelected}
            axis={axis}
            tiersOf={tiersOf}
            deploymentsOf={deploymentsOf}
            healths={healths}
          />

          <div className="foot">
            <span>
              {total}대 중 {kiosks.length}대 불러옴
              {visible.length !== kiosks.length &&
                ` · ${visible.length}대 보임`}
            </span>
            <button
              type="button"
              onClick={loadMore}
              disabled={busy || !(scope?.kind === 'admin' && scope.after)}
            >
              더 보기
            </button>
          </div>
        </section>

        <Splitter
          side="left"
          width={widths.left}
          onResize={setWidth}
          onReset={resetWidths}
        />

        {/* ── 2. 무엇을 ─────────────────────────────────────────── */}
        <section className="pane">
          {scope?.kind !== 'admin' ? (
            <>
              <div className="pane-head">
                <h2 className="pane-title">조합</h2>
              </div>
              <p className="pane-note">
                배포는 운영 팀이 합니다. 업장 계정에서는 자기 키오스크를 직전
                조합으로 되돌리는 롤백만 보낼 수 있습니다.
              </p>
            </>
          ) : (
            <>
              <div className="pane-head">
                <h2 className="pane-title">조합</h2>
                <span className="pane-count">{picked}</span>
                <span className="pane-total">/ {targets.length}</span>
                <span className="spacer" />
                {mode === 'components' && baseline && (
                  <span className="note mono">
                    기준 backend {baseline.version} ·{' '}
                    {surfaceOf(UPDATE_COMPONENT.BACKEND, baseline)?.slice(0, 8)}
                  </span>
                )}
                {mode === 'components' && (
                  <button type="button" onClick={onFill} disabled={busy}>
                    최신으로 채우기
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearPicks}
                  disabled={picked === 0}
                >
                  해제
                </button>
              </div>

              <div className="picker-tools">
                <button
                  type="button"
                  className={onlyPicked ? 'chip' : 'chip is-on'}
                  onClick={() => setOnlyPicked(false)}
                >
                  전체 {targets.length}
                </button>
                <button
                  type="button"
                  className={onlyPicked ? 'chip is-on' : 'chip'}
                  onClick={() => setOnlyPicked(true)}
                  disabled={picked === 0}
                >
                  고른 것만 {picked}
                </button>
                <span className="spacer" />
                <input
                  placeholder="컴포넌트 찾기"
                  value={componentQuery}
                  onChange={(event) => setComponentQuery(event.target.value)}
                />
              </div>

              <div className="picker-head">
                <span />
                <span>컴포넌트</span>
                <span>설명</span>
                <span>표면</span>
                <span className="num">버전</span>
                <span />
              </div>

              <ComponentPicker
                host={host}
                targets={targets.filter(
                  (target) =>
                    (!onlyPicked || picks[target]) &&
                    target.includes(componentQuery.trim().toLowerCase()),
                )}
                picks={picks}
                onPick={onPick}
                onZoom={setZoom}
              />

              {unfilled.length > 0 && (
                <p className="pane-note error">
                  기준 백엔드 {fillBaseline} 와 말이 통하는 버전이 없어 채우지
                  못했습니다: {unfilled.join(', ')}
                </p>
              )}

              <p className="pane-note">
                {mode === 'base'
                  ? '앱을 통째로 다시 설치합니다 — 지금 돌고 있는 세대 조합은 설치본에 구워진 것으로 되돌아갑니다. 설치 중 화면이 내려가고, 이미 그 버전인 키오스크는 설치하지 않습니다.'
                  : '백엔드를 고르면 그것과 말이 통하는(표면이 맞는) 버전만 남습니다. 표면이 맞으면 계약 전체가 달라도 섞어 배포할 수 있습니다.'}
              </p>

              {/* 표는 설명을 한 줄로 묶는다 — 전문은 여기서, 더 길면 확대해서 본다. */}
              <div className="inspector">
                <div className="inspector-head">
                  <h2 className="pane-title">고른 버전</h2>
                  {focusTarget && focusPick ? (
                    <>
                      <span className="what">
                        {labelOf(focusTarget)} {focusPick.version}
                      </span>
                      <span className="surface">
                        {surfaceOf(focusTarget, focusPick)?.slice(0, 8)}
                      </span>
                      <span className="spacer" />
                      <button
                        type="button"
                        onClick={() =>
                          setZoom({
                            target: focusTarget,
                            descriptor: focusPick,
                            siblings: [focusPick],
                          })
                        }
                      >
                        전체 화면으로
                      </button>
                    </>
                  ) : (
                    <span className="note">
                      버전을 고르면 설명과 산출물 정보가 여기 나옵니다
                    </span>
                  )}
                </div>
                {focusTarget && focusPick && (
                  <div className="inspector-body">
                    <DescriptionBox
                      text={
                        focusPick.description ?? '설명이 없는 산출물입니다.'
                      }
                    />
                    <div className="meta">
                      <div>
                        구운 시각 <b>{bakedAtOf(focusPick)}</b>
                      </div>
                      <div>
                        표면{' '}
                        <b>{surfaceOf(focusTarget, focusPick) ?? '없음'}</b>
                      </div>
                      <div>
                        계약 total <b>{focusPick.contractTotal ?? '없음'}</b>
                      </div>
                      <div>
                        sha256 <b>{focusPick.sha256.slice(0, 12)}…</b>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <Splitter
          side="right"
          width={widths.right}
          onResize={setWidth}
          onReset={resetWidths}
        />

        {/* ── 3. 보내기 · 결과 ──────────────────────────────────── */}
        <section className="pane">
          <SendPane
            host={host}
            scopeKind={scope?.kind ?? 'member'}
            kiosks={kiosks}
            selected={selected}
            totalKiosks={total}
            manifest={manifestBody(mode, picks)}
            busy={busy}
            onDeploy={send}
            onDeployAll={sendAll}
            onRollback={sendRollback}
          />
          {error && <p className="error send-error">{error}</p>}
          {loadError && (
            <p className="error send-error">불러오기: {loadError}</p>
          )}
          <ResultsPane
            truncated={batchTruncated}
            gaveUp={pollGaveUp}
            results={results}
            byId={byId}
            action={lastAction}
            busy={busy}
            onRetryFailed={retryFailed}
          />
        </section>
      </div>

      {showTiers && token && (
        <TierPane
          tiers={tiers}
          busy={busy}
          accommodations={accommodations}
          loadDetail={(id) => createFleet(host, token).tierDetail(id)}
          loadTargets={(id) => createFleet(host, token).tierTargets(id)}
          onCreate={(name) =>
            editTiers((fleet) => fleet.createTier(name).then())
          }
          onRename={(id, name) =>
            editTiers((fleet) => fleet.renameTier(id, name))
          }
          onDelete={(id) => editTiers((fleet) => fleet.deleteTier(id))}
          onAdd={(id, ids) =>
            editTiers((fleet) => fleet.addTierMembers(id, ids))
          }
          onRemove={(id, ids) =>
            editTiers((fleet) => fleet.removeTierMembers(id, ids))
          }
          onDeploy={(tier) => deployTier(tier)}
          canDeploy={manifestBody(mode, picks) !== null}
          onClose={() => setShowTiers(false)}
        />
      )}

      {history && (
        <HistoryPane
          rows={history.rows}
          kiosks={kiosks}
          hasMore={history.cursor !== null}
          busy={busy}
          onMore={() => loadHistory(history.cursor ?? undefined)}
          onCancel={cancelDeployments}
          onClose={() => setHistory(null)}
        />
      )}

      {showMatrix && (
        <StateMatrix
          kiosks={kiosks}
          selected={selected}
          deploymentsOf={deploymentsOf}
          healths={healths}
          tiersOf={tiersOf}
          onClose={() => setShowMatrix(false)}
        />
      )}

      {zoom && (
        <VersionDetail
          target={zoom.target}
          descriptor={zoom.descriptor}
          siblings={zoom.siblings}
          chosen={picks[zoom.target]}
          onShow={(descriptor) =>
            setZoom((prev) => (prev ? { ...prev, descriptor } : prev))
          }
          onPick={onPick}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}
