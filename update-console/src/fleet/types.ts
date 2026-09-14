/**
 * 콘솔이 서버에서 읽는 모양 — **두 축**.
 *
 * 서버(VNDT-2291/ADR-0008)가 축을 갈라 든다: `EntityVersion` 은 **키오스크가 돈다고 말한
 * 것**이고, `Deployment` 는 **서버가 시킨 것과 그 결말**이다. 한 값이 두 뜻을 지면 읽는
 * 쪽이 둘을 봉합하게 되므로 여기서도 갈라 둔다.
 *
 * "지금 무엇이 도는가"는 앞에 묻고, "그 지시가 어떻게 끝났는가"는 뒤에 묻는다.
 *
 * **시각은 전부 epoch 밀리초다.** 서버의 `Date` 스칼라가 `value.getTime()` 으로
 * 직렬화하므로 와이어에 숫자가 온다 — 문자열로 알고 `Date.parse` 를 태우면 NaN 이 되고,
 * NaN 비교는 전부 false 라 판정이 조용히 죽는다(실측: "Invalid Date" 와 미적용 판정 무효화).
 * 경계에서 숫자로 받고 안쪽은 계속 숫자로 다룬다.
 */

/**
 * 갈아끼우는 단위. **서버는 문자열로만 본다** — 우리가 아는 컴포넌트 집합보다 넓을 수
 * 있으므로(새 장치가 먼저 배포될 수 있다) 닫지 않는다. 화면은 아는 것을 먼저 그리고
 * 모르는 것을 뒤에 붙인다.
 */
export type Domain = string;

/** 앱 설치본이 실려 오는 도메인 — 컴포넌트가 아니라 다른 축이다. */
export const BASE_DOMAIN = 'base';

export type DeploymentStatus = 'SENT' | 'COMPLETED' | 'FAILED' | 'CANCELED';

/**
 * 키오스크가 돈다고 말한 것.
 *
 * `removedAt` 이 찍힌 것은 **한때 보고됐다가 스냅샷에서 사라진** 도메인이다. 키오스크는
 * 설치본 동봉본으로 돌아간 컴포넌트를 보고하지 않으므로(버전이 아니라 "동봉본"이라는
 * 표시라 서버 스키마에 실을 수 없다), 이 표시는 대개 "그 세대를 더는 안 쓴다"는 뜻이다.
 */
export type EntityVersion = {
  domain: Domain;
  version: string;
  previousVersion: string | null;
  /** epoch ms. */
  reportedAt: number;
  /** epoch ms. */
  removedAt: number | null;
};

/** 서버가 시킨 것과 그 결말. */
export type Deployment = {
  id: string;
  /** 한 발송. 같은 batchId 의 행들은 함께 움직인다. */
  batchId: string;
  kioskId: string;
  domain: Domain;
  version: string;
  previousVersion: string | null;
  status: DeploymentStatus;
  errorMessage: string | null;
  /** 이 발송을 누른 사람. 서버 `Actor` 에서 사람이 읽는 값만 뽑는다. */
  createdBy: string | null;
  /** epoch ms. */
  createdAt: number;
  /** epoch ms. */
  updatedAt: number;
};

/**
 * 티어 — 차수 묶음.
 *
 * `rank` 가 없다. 서버가 순서를 들지 않기로 했고(중복 소속도 허용), 순서가 필요하면
 * 이름으로 짠다. 그래서 한 업장이 **여러 티어**에 속할 수 있다.
 */
export type Tier = { id: string; name: string };

/** 업장 id → 속한 티어 id 들. 없으면 미배정 — 티어 배포에서 빠진다. */
export type TierAssignment = Readonly<Record<string, readonly string[]>>;

/** 티어에 매인 업장 하나. 이름은 서버가 준다 — 화면에 안 불러온 업장도 보여야 한다. */
export type TierMember = { accommodationId: string; name: string };

export type TierDetail = Tier & { members: readonly TierMember[] };

/**
 * 콘솔이 읽는 것.
 *
 * 실재(`EntityVersion`)는 여기 없다 — 키오스크 목록 쿼리에 `Kiosk.versions` 로 딸려 오는
 * 것이 유일한 배치 경로라, 따로 물으면 대수만큼 왕복이 생긴다. 그 매핑은 `api.ts` 가
 * 진다(같은 어댑터 층이다).
 *
 * 쓰기가 여기 있는 이유: 이제 진짜 서버가 받는다. 목이던 시절에는 저장을 흉내 내면
 * 새로고침에 사라지는 것을 사람이 저장됐다고 믿어서 일부러 넣지 않았다.
 */
export type FleetSource = {
  /**
   * 손댈 것이 있는 배포만. 끝난 것(COMPLETED·CANCELED)은 판정에 쓰이지 않으므로 긁지
   * 않는다 — 이력 화면이 따로 묻는다.
   */
  openDeployments(): Promise<readonly Deployment[]>;
  tiers(): Promise<{ tiers: readonly Tier[]; assignment: TierAssignment }>;

  /**
   * 배포 지시 — **대상 N 개를 한 호출로** 보낸다.
   *
   * 키오스크마다 따로 쏘던 것과 근본적으로 다르다: 서버가 한 트랜잭션에서 행을 만들고
   * 한 `batchId` 로 묶으므로, 부분 성공이라는 중간 상태가 발송 단계에 없다. 진행은
   * 접수가 아니라 그 행들의 status 가 말한다.
   */
  requestDeployment(input: DeploymentRequest): Promise<DeploymentBatch>;

  /**
   * 한 발송의 지금 상태 — 진행을 보려면 이걸 다시 묻는다.
   *
   * `total` 은 서버가 센 값이라 **쪽 상한에 잘리지 않는다.** 행은 잘릴 수 있으므로
   * (수백 대 × 여러 컴포넌트) 진행률은 행을 세지 말고 이 값으로 계산해야 한다.
   */
  batch(batchId: string): Promise<DeploymentPage>;

  /**
   * 이력 — 최근 것부터. 발송 단위 묶기는 화면이 `batchId` 로 한다.
   *
   * 행 단위로 오는 것을 그대로 받는다: 서버가 발송을 한 덩어리로 주지 않기 때문이고,
   * 그 편이 "이 기기에서 무슨 일이 있었나"를 되묻기도 쉽다.
   */
  history(cursor?: string): Promise<DeploymentPage>;

  /** 티어 하나의 속살 — 어느 업장이 매여 있나. */
  tierDetail(tierId: string): Promise<TierDetail>;

  /**
   * 이 티어가 **지금** 펼쳐지는 키오스크.
   *
   * 배포는 발송 시점에 펼치므로(그래야 그 사이 새로 설치된 기기가 자동으로 포함된다)
   * 화면이 보여주는 것도 저장된 목록이 아니라 지금의 전개 결과여야 한다. `STOPPED`
   * 상태의 기기는 서버가 빼고 준다.
   */
  tierTargets(tierId: string): Promise<readonly { id: string; name: string }[]>;

  createTier(name: string): Promise<Tier>;
  renameTier(tierId: string, name: string): Promise<void>;
  deleteTier(tierId: string): Promise<void>;
  /** 업장을 매고 푼다. 중복 소속이 허용되므로 다른 티어에서 빼지 않는다. */
  addTierMembers(
    tierId: string,
    accommodationIds: readonly string[],
  ): Promise<void>;
  removeTierMembers(
    tierId: string,
    accommodationIds: readonly string[],
  ): Promise<void>;

  /**
   * 미결 지시를 닫는다.
   *
   * 옛 펌웨어 기기처럼 **영영 오지 않을 결과**를 기다리는 행이 생긴다. 그대로 두면 판정이
   * 계속 "이상"으로 잡아 진짜 문제를 덮는다. `SENT` 만 닫을 수 있다(서버가 막는다).
   */
  cancel(deploymentId: string): Promise<void>;
};

export type DeploymentPage = {
  rows: readonly Deployment[];
  /** 다음 쪽이 있으면 그 자리. 없으면 null. */
  cursor: string | null;
  total: number;
};

/** 한 컴포넌트의 목표 버전. 앱 설치본은 `base` 도메인으로 간다. */
export type DeploymentComponent = { domain: Domain; version: string };

/**
 * 대상은 **티어이거나 개별 기기**다.
 *
 * 티어로 보내면 서버가 발송 시점에 펼친다 — 그래야 그 사이 새로 설치된 키오스크가
 * 자동으로 포함된다. 화면이 미리 펼쳐 기기 목록으로 보내면 그 자동 포함이 사라진다.
 */
export type DeploymentRequest = {
  kioskIds?: readonly string[];
  tierId?: string;
  components: readonly DeploymentComponent[];
};

export type DeploymentBatch = {
  batchId: string;
  deployments: readonly Deployment[];
};
