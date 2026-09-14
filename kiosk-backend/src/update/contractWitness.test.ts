import { describe, expect, test } from 'bun:test';
import { createContractWitness } from './contractWitness';

/** 상대별 기대 표면 — 실제 배선은 types 의 surfaceContractOf 가 채운다. */
const EXPECTED: Record<string, string> = {
  frontend: 'FB',
  'token-dispenser': 'CASH',
  suprema: 'SUP',
};

const witness = () => createContractWitness((component) => EXPECTED[component]);

describe('표면 지문 관측', () => {
  test('아무도 안 알려오면 일관된 것으로 본다', () => {
    expect(witness().isConsistent()).toBe(true);
  });

  test('각자 자기 표면만 맞으면 일관된다 — total 이 달라도 무관하다 ★', () => {
    // 장치 스키마만 움직인 배포: 프론트와 suprema 는 옛 세대 그대로다. 표면 판정에선
    // 이 혼합이 정상이어야 한다 — total 대조였다면 여기서 되감겼다.
    const w = witness();
    w.observe('frontend', 'FB');
    w.observe('token-dispenser', 'SUP');
    w.observe('token-dispenser', 'CASH');

    expect(w.isConsistent()).toBe(true);
    expect(w.mismatches()).toEqual([]);
  });

  test('자기 표면이 어긋난 것만 잡는다', () => {
    const w = witness();
    w.observe('frontend', 'FB');
    w.observe('token-dispenser', 'DRIFTED');

    expect(w.isConsistent()).toBe(false);
    expect(w.mismatches()).toEqual([
      { component: 'token-dispenser', observed: 'DRIFTED' },
    ]);
  });

  test('여럿이 어긋나면 전부 보고한다 — 어디가 갈렸는지 알아야 고친다', () => {
    const w = witness();
    w.observe('frontend', 'OTHER');
    w.observe('token-dispenser', 'OTHER');

    expect(w.mismatches().map((m) => m.component)).toEqual([
      'frontend',
      'token-dispenser',
    ]);
  });

  test('표면을 안 싣는 산출물은 판정하지 않는다 — 없는 것을 불일치로 보면 옛 세대가 전부 거부된다', () => {
    const w = witness();
    w.observe('ime', undefined);
    w.observe('ime', '');

    expect(w.isConsistent()).toBe(true);
  });

  test('기대 표면을 모르는 상대는 판정하지 않는다', () => {
    const w = witness();
    w.observe('unknown-process', 'ANYTHING');

    expect(w.isConsistent()).toBe(true);
  });

  test('나중 관측이 이전 값을 덮는다 — 세대가 갈리면 지문도 갈린다', () => {
    const w = witness();
    w.observe('token-dispenser', 'DRIFTED');
    expect(w.isConsistent()).toBe(false);

    w.observe('token-dispenser', 'CASH');
    expect(w.isConsistent()).toBe(true);
  });

  test('404 로 드러난 불일치는 뒤이은 정상 응답이 못 덮는다', () => {
    const w = witness();
    w.reject('token-dispenser');
    w.observe('token-dispenser', 'CASH');

    expect(w.isConsistent()).toBe(false);
  });
});
