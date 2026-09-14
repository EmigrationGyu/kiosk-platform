import type { ContractWitness } from './contractWitness';

/**
 * 승격/되감기 판정 — **근거가 갱신될 때마다** 다시 본다.
 *
 * 부팅 완주 한 번만 보면 놓친다: 장치는 지연 spawn 이라 홈 진입 시점에 아직 접촉되지 않았을 수 있고,
 * 그러면 어긋난 지문이 관측되기 전에 "일치"로 판정된다(실측: 불일치가 다음 부팅에야 드러났다).
 *
 * **판정은 조합에 붙는다.** 승격으로 끝내버리면 백엔드가 살아남는 적용(프론트·장치 단독) 뒤에 재판정이
 * 없어, 새 조합은 승격도 안 되고 불일치 트립와이어도 꺼진 채로 남는다. 되감기만 종결이다 — 되감기
 * 중에 또 되감으면 안 된다.
 *
 * 근거도 조합에 붙는다: 부팅 완주는 **그때의 조합**에 대한 증거라 프론트가 갈리면 새 렌더러가 다시
 * 선언해야 한다. 다만 렌더러가 보증하는 것은 **렌더러↔백엔드 사슬**뿐이다 — 장치까지 스탬프에 넣으면
 * 장치 단독 적용은 재선언할 계기가 없어 영영 승격되지 않는다.
 *
 * 교체된 장치의 "아직 안 답했다"는 여기서 든다. activity 레코드에 적으면 reaper 가 지우고(idle 화면에서
 * 적용하므로 이미 5분을 넘겨 있다) 의무가 통째로 사라진다.
 */
export type PromotionJudge = {
  /** 렌더러가 홈까지 갔다고 알려왔다. */
  /** surface = 프론트↔백엔드 합성 표면 지문. 옛 프론트는 안 실어 보낸다(그럼 판정 보류). */
  rendererBooted(surface: string | undefined): void;
  /** 장치가 봉투를 돌려줬다 — 관측이 갱신됐으니 다시 본다. */
  deviceAnswered(process: string): void;
  /** 이 장치들의 세대가 갈렸다 — 새 세대가 답할 때까지 승격을 막는다. */
  awaitEvidence(processes: readonly string[]): void;
};

export function createPromotionJudge(deps: {
  witness: ContractWitness;
  /** 말을 걸어본 서브프로세스가 전부 답했는가. */
  allAnswered: () => boolean;
  /** 지금 실행 중인 조합의 식별자 — 갈리면 다시 판정한다. */
  currentCombination: () => string;
  /** 렌더러 완주가 실제로 보증하는 성분(프론트·백엔드)만의 식별자. */
  rendererChain: () => string;
  onMismatch: (detail: string) => void;
  onPromote: () => void;
  onWait: () => void;
}): PromotionJudge {
  /** 부팅 완주를 선언한 조합. 지금 조합과 다르면 그 증거는 이 조합의 것이 아니다. */
  let bootedAt: string | null = null;
  let rolledBack = false;
  /** 마지막으로 승격한 조합. 지금 조합이 이것과 같으면 더 볼 것이 없다. */
  let promoted: string | null = null;
  let waitLogged = false;
  /** 이 키오스크가 실제로 말을 걸어본 장치 — 안 걸어본 것은 워킹셋이 아니라 무관하다. */
  const everAnswered = new Set<string>();
  /** 세대가 갈려 아직 새 증거를 못 받은 장치. */
  const awaiting = new Set<string>();

  function evaluate(): void {
    // 부팅 완주 전에는 판정하지 않는다 — 렌더러가 살아있다는 증거가 아직 없다.
    if (bootedAt === null || rolledBack) return;

    // 불일치는 승격 뒤에도 본다 — 지연 spawn 장치는 승격 후에야 처음 접촉될 수 있다.
    if (!deps.witness.isConsistent()) {
      rolledBack = true;
      deps.onMismatch(
        deps.witness
          .mismatches()
          .map((m) => `${m.component}=${m.observed.slice(0, 12)}`)
          .join(' '),
      );
      return;
    }

    if (bootedAt !== deps.rendererChain()) return;

    const combination = deps.currentCombination();
    if (combination === promoted) return;

    if (awaiting.size > 0 || !deps.allAnswered()) {
      // 아직 답하지 않은 장치가 있다 — 답할 때 다시 불린다. 로그는 한 번만.
      if (!waitLogged) {
        waitLogged = true;
        deps.onWait();
      }
      return;
    }

    promoted = combination;
    waitLogged = false;
    deps.onPromote();
  }

  return {
    rendererBooted(surface) {
      deps.witness.observe('frontend', surface);
      bootedAt = deps.rendererChain();
      evaluate();
    },

    deviceAnswered(process) {
      everAnswered.add(process);
      awaiting.delete(process);
      evaluate();
    },

    awaitEvidence(processes) {
      // 한 번도 안 물어본 장치는 그대로 무관하다 — 설치되지 않은 장치(kovan 등) 때문에
      // 승격이 영영 막히면 last-stable 이 아주 먼 과거에 박힌다.
      for (const process of processes) {
        if (everAnswered.has(process)) awaiting.add(process);
      }
    },
  };
}
