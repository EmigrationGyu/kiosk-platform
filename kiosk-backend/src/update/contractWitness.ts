/**
 * 실행 중인 조합이 **말이 통하는 계약으로 빌드됐는지** 지켜본다.
 *
 * 각 컴포넌트가 자기 **표면 지문**을 스스로 알린다 — 장치는 응답 봉투에 자기 프로세스 표면을, 렌더러는
 * 부팅 완주 요청에 프론트↔백엔드 합성 표면을. 백엔드는 상대별로 기대 표면과 대조하기만 한다.
 *
 * total 이 아니라 **표면 단위**로 대조하는 이유: 장치 스키마만 움직인 변경에서 프론트는 무관한
 * 이해관계자다. total 로 보면 장치 하나를 갈려고 전 컴포넌트를 같은 세대로 배포해야 한다.
 *
 * 놓친 경우는 런타임 백스톱이 받는다 — 백엔드는 모르는 주소에 `contractMismatchCause`, 장치는 모르는
 * 이벤트에 같은 표식의 404 로 답한다.
 */
export type ContractWitness = {
  /** 표면 지문을 알려온 컴포넌트를 기록한다. 값이 없으면 무시한다(옛 산출물). */
  observe(component: string, surface: unknown): void;
  /**
   * 지문 없이 드러난 불일치 — 모르는 이벤트에 404 로 답한 장치 같은 런타임 백스톱.
   * 지문을 싣지 않는 옛 산출물은 `observe` 로는 잡히지 않는다.
   */
  reject(component: string): void;
  /** 지금까지 관측된 것이 전부 내 기대 표면과 같은가. */
  isConsistent(): boolean;
  /** 어긋난 컴포넌트들 — 로그·보고용. */
  mismatches(): { component: string; observed: string }[];
};

/** 지문 대신 기록되는 불일치 표식 — 어떤 지문과도 같지 않다. */
const REJECTED = '모르는 이벤트';

export function createContractWitness(
  /** 상대별 기대 표면 — 'frontend' 는 합성, 장치는 자기 프로세스. 모르는 상대는 undefined. */
  expected: (component: string) => string | undefined,
): ContractWitness {
  const observed = new Map<string, string>();
  const rejected = new Set<string>();

  return {
    observe(component, surface) {
      // 표면을 싣지 않는 산출물은 판정하지 않는다 — 없는 것을 불일치로 보면 옛 세대가
      // 전부 거부당한다. 그 창은 런타임 백스톱이 받는다.
      if (typeof surface !== 'string' || surface.length === 0) return;
      // 기대 표면을 모르는 상대도 판정하지 않는다 — 내가 모르는 상대를 어긋났다고
      // 볼 근거가 없다.
      if (expected(component) === undefined) return;
      // 한 번 드러난 불일치는 취소되지 않는다 — 뒤이은 정상 응답이 덮으면 사라진다.
      if (rejected.has(component)) return;
      observed.set(component, surface);
    },

    reject(component) {
      rejected.add(component);
      observed.set(component, REJECTED);
    },

    isConsistent() {
      for (const [component, surface] of observed) {
        if (surface !== expected(component)) return false;
      }
      return true;
    },

    mismatches() {
      return [...observed.entries()]
        .filter(([component, surface]) => surface !== expected(component))
        .map(([component, observed]) => ({ component, observed }));
    },
  };
}
