import { describe, expect, test } from 'bun:test';
import { createContractWitness } from './contractWitness';
import { createPromotionJudge } from './promotionJudge';

const OWN = 'aaaa';
const DEVICE = 'cash-dispenser';
const OTHER = 'bbbb';

function setup(options?: { allAnswered?: boolean }) {
  // 판정 자체가 관심사라 기대 표면은 전 상대 동일 상수로 둔다(표면별 구별은 witness 테스트 몫).
  const witness = createContractWitness(() => OWN);
  let answered = options?.allAnswered ?? true;
  let combination = 'frontend=baseline';
  let chain = 'frontend=baseline';
  const calls = { mismatch: [] as string[], promote: 0, wait: 0 };

  const judge = createPromotionJudge({
    witness,
    allAnswered: () => answered,
    currentCombination: () => combination,
    rendererChain: () => chain,
    onMismatch: (detail) => calls.mismatch.push(detail),
    onPromote: () => {
      calls.promote += 1;
    },
    onWait: () => {
      calls.wait += 1;
    },
  });

  return {
    judge,
    witness,
    calls,
    setAnswered: (value: boolean) => {
      answered = value;
    },
    /** 장치만 갈렸다 — 렌더러 사슬은 그대로다. */
    setCombination: (value: string) => {
      combination = value;
    },
    /** 프론트나 백엔드가 갈렸다 — 렌더러 사슬도 함께 갈린다. */
    setChain: (value: string) => {
      chain = value;
      combination = value;
    },
  };
}

describe('판정 시점', () => {
  test('부팅 완주 전에는 판정하지 않는다 — 렌더러가 산다는 증거가 없다', () => {
    const h = setup();
    h.witness.observe('cash-dispenser', OTHER);

    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.mismatch).toEqual([]);
    expect(h.calls.promote).toBe(0);
  });

  test('부팅 완주 + 전부 일치 + 전부 응답이면 승격한다', () => {
    const h = setup();
    h.judge.rendererBooted(OWN);

    expect(h.calls.promote).toBe(1);
  });

  test('아직 답하지 않은 장치가 있으면 기다린다', () => {
    const h = setup({ allAnswered: false });
    h.judge.rendererBooted(OWN);

    expect(h.calls.promote).toBe(0);
    expect(h.calls.wait).toBe(1);
  });

  test('나중에 답하면 그때 승격한다 — 지연 spawn 을 놓치지 않는다', () => {
    const h = setup({ allAnswered: false });
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(0);

    h.setAnswered(true);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.promote).toBe(1);
  });

  test('나중에 어긋난 지문이 관측되면 그때 되감는다 ★', () => {
    const h = setup({ allAnswered: false });
    // 홈 진입 시점엔 장치가 아직 접촉되지 않아 관측이 비어 있다.
    h.judge.rendererBooted(OWN);
    expect(h.calls.mismatch).toEqual([]);

    // 뒤늦게 장치가 어긋난 지문으로 답했다.
    h.witness.observe('cash-dispenser', OTHER);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.mismatch).toEqual([`cash-dispenser=${OTHER}`]);
  });

  test('렌더러 지문이 어긋나면 응답을 기다리지 않고 즉시 되감는다', () => {
    const h = setup({ allAnswered: false });
    h.judge.rendererBooted(OTHER);

    expect(h.calls.mismatch).toHaveLength(1);
    expect(h.calls.wait).toBe(0);
  });
});

describe('판정은 조합에 붙는다', () => {
  test('같은 조합은 두 번 승격하지 않는다', () => {
    const h = setup();
    h.judge.rendererBooted(OWN);
    h.judge.deviceAnswered(DEVICE);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.promote).toBe(1);
  });

  test('조합이 갈리면 다시 판정한다 — 백엔드가 살아남는 적용도 승격되어야 한다 ★', () => {
    const h = setup();
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(1);

    // 프론트 단독 적용 — 백엔드는 그대로라 판정자도 리셋되지 않는다.
    h.setChain('frontend=f2');
    h.judge.rendererBooted(OWN);

    expect(h.calls.promote).toBe(2);
  });

  test('승격 뒤에 어긋난 지문이 오면 되감는다 — 지연 spawn 장치는 승격 후에 접촉된다 ★', () => {
    const h = setup();
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(1);

    h.witness.observe('cash-dispenser', OTHER);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.mismatch).toEqual([`cash-dispenser=${OTHER}`]);
  });

  test('교체된 장치가 답하기 전에는 승격하지 않는다 ★', () => {
    const h = setup();
    h.judge.deviceAnswered(DEVICE); // 이 키오스크가 실제로 쓰는 장치다
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(1);

    // 장치 단독 적용 — 렌더러 사슬은 그대로라 재선언 계기가 없다.
    h.setCombination('cash-dispenser=d2');
    h.judge.awaitEvidence([DEVICE]);
    h.judge.rendererBooted(OWN);

    // 여기서 승격하면 어긋난 조합이 stable 로 박혀 되감을 곳이 사라진다(실측).
    expect(h.calls.promote).toBe(1);

    h.witness.observe(DEVICE, OTHER);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.mismatch).toEqual([`cash-dispenser=${OTHER}`]);
  });

  test('장치가 답하면 승격한다 — 장치 단독 적용도 승격 계기가 있어야 한다 ★', () => {
    const h = setup();
    h.judge.deviceAnswered(DEVICE);
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(1);

    h.setCombination('cash-dispenser=d2');
    h.judge.awaitEvidence([DEVICE]);
    expect(h.calls.promote).toBe(1);

    // 렌더러는 재선언하지 않는다(리로드도 포트 교체도 없다) — 장치 응답만이 계기다.
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.promote).toBe(2);
  });

  test('한 번도 안 물어본 장치는 교체돼도 승격을 막지 않는다 — 미설치 장치가 stable 을 얼린다 ★', () => {
    const h = setup();
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(1);

    h.setCombination('kovan-cardpayment=k2');
    h.judge.awaitEvidence(['kovan-cardpayment']);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.promote).toBe(2);
  });

  test('프론트가 갈리면 새 렌더러가 선언하기 전까지 승격하지 않는다 ★', () => {
    const h = setup();
    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(1);

    // 프론트 단독 적용 — 옛 프론트의 완주는 이 사슬의 증거가 아니다.
    h.setChain('frontend=f5');
    h.judge.deviceAnswered(DEVICE);
    expect(h.calls.promote).toBe(1);

    h.judge.rendererBooted(OWN);
    expect(h.calls.promote).toBe(2);
  });

  test('되감은 뒤에는 조합이 갈려도 판정하지 않는다', () => {
    const h = setup();
    h.witness.observe('token-dispenser', OTHER);
    h.judge.rendererBooted(OWN);
    expect(h.calls.mismatch).toHaveLength(1);

    h.setChain('frontend=f2');
    h.judge.rendererBooted(OWN);

    expect(h.calls.mismatch).toHaveLength(1);
    expect(h.calls.promote).toBe(0);
  });
});

describe('한 번만 결론낸다', () => {
  test('되감기 중에 또 되감지 않는다', () => {
    const h = setup();
    h.witness.observe('token-dispenser', OTHER);
    h.judge.rendererBooted(OWN);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.mismatch).toHaveLength(1);
  });

  test('모르는 이벤트 응답은 지문 없이도 불일치다 — 옛 산출물의 유일한 증거다 ★', () => {
    const h = setup();
    h.witness.reject('receipt-printer');
    h.judge.rendererBooted(OWN);

    expect(h.calls.mismatch).toEqual(['receipt-printer=모르는 이벤트']);
  });

  test('기다림 로그는 한 번만 남긴다 — 장치마다 반복되면 시끄럽다', () => {
    const h = setup({ allAnswered: false });
    h.judge.rendererBooted(OWN);
    h.judge.deviceAnswered(DEVICE);
    h.judge.deviceAnswered(DEVICE);

    expect(h.calls.wait).toBe(1);
  });
});
