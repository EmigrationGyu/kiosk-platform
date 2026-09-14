import { describe, expect, test } from 'bun:test';
import { EMPTY, merge, NEVER } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import {
  allGatesOpen,
  createIdleCleanupStream,
  createIdleStream,
} from './idleStream';

/**
 * createIdleStream 마블 테스트. 시간축 코어를 가상 시간으로 결정론적으로 박제한다.
 * (DOM·store·타이머 없음 — bun test 에서 TestScheduler 로 실행.)
 *
 * 프레임 = 가상 ms. cfg = { timeoutMs: 30, graceMs: 10 } 로 통일.
 */
const CFG = { timeoutMs: 30, graceMs: 10 };
const VALUES = { c: 'counting', w: 'warn', f: 'fire' } as const;

const scheduler = () =>
  new TestScheduler((actual, expected) => expect(actual).toEqual(expected));

describe('createIdleStream', () => {
  test('무동작 지속 → warn@timeout · fire@timeout+grace', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t', { t: true });
      const out$ = createIdleStream(active$, EMPTY, NEVER, CFG);
      expectObservable(out$).toBe('30ms w 9ms f', VALUES);
    });
  });

  test('timeout 전 활동 → 카운팅 리셋(warn 이 활동시점+timeout 으로 밀림)', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t', { t: true });
      const activity$ = hot('20ms x', { x: 0 });
      const out$ = createIdleStream(active$, activity$, NEVER, CFG);
      // 활동@20 → warn 은 20+30=50, fire 는 60.
      expectObservable(out$).toBe('50ms w 9ms f', VALUES);
    });
  });

  test('경고 중 ambient 활동은 경고를 안 끔(fire 발생)', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t', { t: true });
      const activity$ = hot('35ms x', { x: 0 }); // warn(@30) 노출 중 활동
      const out$ = createIdleStream(active$, activity$, NEVER, CFG);
      // 활동@35 는 경고를 못 끔 → fire@40 그대로 발생.
      // (단 카운팅은 리셋돼 exhaustMap 이 풀린 뒤 다음 warn@65 · fire@75)
      expectObservable(out$).toBe('30ms w 9ms f 24ms w 9ms f', VALUES);
    });
  });

  test('경고 중 resume(버튼) → 해제(counting), fire 안 함', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t', { t: true });
      const resume$ = hot('35ms r', { r: 0 }); // warn(@30) 노출 중 버튼
      const out$ = createIdleStream(active$, EMPTY, resume$, CFG);
      expectObservable(out$).toBe('30ms w 4ms c', VALUES);
    });
  });

  test('resume 후에도 다음 경고 정상(resume$ 미완료여도 exhaustMap 안 막힘)', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t', { t: true });
      const activity$ = hot('40ms a', { a: 0 }); // resume 뒤 활동 → 카운팅 재개
      // 실제 idleResume$ 는 Subject라 complete 안 됨 → NEVER 로 재현(take(1) 없으면 여기서 막힘)
      const resume$ = merge(hot('35ms r', { r: 0 }), NEVER);
      const out$ = createIdleStream(active$, activity$, resume$, CFG);
      // warn@30 → resume@35(counting) → 활동@40 → 다음 warn@70 · fire@80
      expectObservable(out$).toBe('30ms w 4ms c 34ms w 9ms f', VALUES);
    });
  });

  test('비활성 전이 → counting(경고 해제), fire 안 함', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t 34ms f', { t: true, f: false });
      const out$ = createIdleStream(active$, EMPTY, NEVER, CFG);
      // warn@30, 35 프레임에 비활성 → counting. fire(40) 발생 안 함.
      expectObservable(out$).toBe('30ms w 4ms c', VALUES);
    });
  });

  test('비활성으로 시작 → counting 만, 절대 fire 안 함', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('f', { f: false });
      const out$ = createIdleStream(active$, EMPTY, NEVER, CFG);
      expectObservable(out$).toBe('c', VALUES);
    });
  });

  test('cfg 값이 하드코딩 아님(timeout=50, grace=20)', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const active$ = hot('t', { t: true });
      const out$ = createIdleStream(active$, EMPTY, NEVER, {
        timeoutMs: 50,
        graceMs: 20,
      });
      expectObservable(out$).toBe('50ms w 19ms f', VALUES);
    });
  });
});

describe('createIdleCleanupStream', () => {
  const CFG_C = { timeoutMs: 30 };
  // 방출값은 void(undefined) — 마블 문자 'c' 를 undefined 로 매핑.
  const CLEANUP = { c: undefined };

  test('오버레이 있음 + 무동작 → timeout 후 1회 방출', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('t', { t: true });
      const out$ = createIdleCleanupStream(hasOverlays$, EMPTY, CFG_C);
      expectObservable(out$).toBe('30ms c', CLEANUP);
    });
  });

  test('활동 → 타이머 재무장(활동시점+timeout 에 방출)', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('t', { t: true });
      const activity$ = hot('20ms x', { x: 0 });
      const out$ = createIdleCleanupStream(hasOverlays$, activity$, CFG_C);
      expectObservable(out$).toBe('50ms c', CLEANUP);
    });
  });

  test('오버레이 없음 → 절대 무방출(타이머 안 돎)', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('f', { f: false });
      const out$ = createIdleCleanupStream(hasOverlays$, EMPTY, CFG_C);
      expectObservable(out$).toBe('');
    });
  });

  test('게이트 닫힘→재오픈 → 새 타이머로 재무장', () => {
    scheduler().run(({ hot, expectObservable }) => {
      // 오픈@0, 닫힘@10, 재오픈@20 → 재오픈 기준 timeout 30 → 방출@50
      const hasOverlays$ = hot('t 9ms f 9ms t', { t: true, f: false });
      const out$ = createIdleCleanupStream(hasOverlays$, EMPTY, CFG_C);
      expectObservable(out$).toBe('50ms c', CLEANUP);
    });
  });
});

/**
 * 잠금을 게이트에 합친 뒤의 수거 동작. `useIdleCleanup` 이 실제로 쓰는 조합
 * (`allGatesOpen(hasOverlays$, unlocked$)`)을 그대로 박제한다.
 *
 * 근거(2026-09-02): 원격 카드 취소가 홈 관문 위에서 모달로 돌게 되면서, 카드 왕복
 * (요청 상한 10분) 중에 3분 수거가 모달을 걷으면 단말 응답을 받을 화면이 없어 돈만
 * 나가고 장부가 안 닫힌다. 잠금이 게이트를 닫아야 하고, 풀리면 예산이 새로 시작해야
 * 한다(발화 시점 건너뛰기는 1회 방출이라 다시 발화하지 않는다).
 */
describe('createIdleCleanupStream × allGatesOpen — 잠금은 게이트다', () => {
  const CFG_C = { timeoutMs: 30 };
  const CLEANUP = { c: undefined };
  const B = { t: true, f: false };

  test('회귀 없음: 잠금이 없으면 오버레이 게이트 하나일 때와 같다 ★', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('t 9ms f 9ms t', B);
      const unlocked$ = hot('t', B);
      const out$ = createIdleCleanupStream(
        allGatesOpen(hasOverlays$, unlocked$),
        EMPTY,
        CFG_C,
      );
      // 위 '게이트 닫힘→재오픈' 과 동일한 마블.
      expectObservable(out$).toBe('50ms c', CLEANUP);
    });
  });

  test('오버레이가 있어도 잠금 중엔 절대 걷지 않는다 ★', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('t', B);
      const unlocked$ = hot('f', B); // in-flight 로 시작
      const out$ = createIdleCleanupStream(
        allGatesOpen(hasOverlays$, unlocked$),
        EMPTY,
        CFG_C,
      );
      expectObservable(out$).toBe('');
    });
  });

  test('카운트 도중 잠금 → 발화 억제, 해제 시점부터 예산이 새로 시작 ★', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('t', B);
      // 잠금@10(카드 왕복 시작), 해제@40(응답 도착) → 해제 기준 30 → 방출@70.
      // 예전처럼 원래 타이머(@30)가 살아 있었다면 왕복 도중 걷혔다.
      const unlocked$ = hot('t 9ms f 29ms t', B);
      const out$ = createIdleCleanupStream(
        allGatesOpen(hasOverlays$, unlocked$),
        EMPTY,
        CFG_C,
      );
      expectObservable(out$).toBe('70ms c', CLEANUP);
    });
  });

  test('잠금 해제 뒤 활동이 있으면 활동 기준으로 다시 센다', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('t', B);
      const unlocked$ = hot('t 9ms f 9ms t', B); // 해제@20
      const activity$ = hot('35ms x', { x: 0 });
      const out$ = createIdleCleanupStream(
        allGatesOpen(hasOverlays$, unlocked$),
        activity$,
        CFG_C,
      );
      // 해제@20 → 활동@35 → 방출@65
      expectObservable(out$).toBe('65ms c', CLEANUP);
    });
  });

  test('잠금이 풀려도 오버레이가 없으면 걷을 것이 없다', () => {
    scheduler().run(({ hot, expectObservable }) => {
      const hasOverlays$ = hot('f', B);
      const unlocked$ = hot('f 19ms t', B);
      const out$ = createIdleCleanupStream(
        allGatesOpen(hasOverlays$, unlocked$),
        EMPTY,
        CFG_C,
      );
      expectObservable(out$).toBe('');
    });
  });

  test('게이트 셋(관문 복귀: 잠금 + idle 억제) — 하나라도 닫히면 닫힌다', () => {
    scheduler().run(({ hot, expectObservable }) => {
      // 원격 취소 실행 중 idle 억제 키가 잡혀 있다가 소진@40 에 풀린다.
      const unlocked$ = hot('t', B);
      const idleAllowed$ = hot('f 39ms t', B);
      const out$ = createIdleCleanupStream(
        allGatesOpen(unlocked$, idleAllowed$),
        EMPTY,
        CFG_C,
      );
      expectObservable(out$).toBe('70ms c', CLEANUP);
    });
  });

  test('allGatesOpen 은 결과가 바뀔 때만 흘린다 — 같은 값 반복이 타이머를 리셋하지 않는다 ★', () => {
    scheduler().run(({ hot, expectObservable }) => {
      // 게이트 하나가 t 를 거듭 흘려도(스토어 재통지) 합성 결과는 그대로 t 라 타이머가 안 밀린다.
      const hasOverlays$ = hot('t 9ms t 9ms t', B);
      const unlocked$ = hot('t', B);
      expectObservable(allGatesOpen(hasOverlays$, unlocked$)).toBe('t', B);
      const out$ = createIdleCleanupStream(
        allGatesOpen(hasOverlays$, unlocked$),
        EMPTY,
        CFG_C,
      );
      expectObservable(out$).toBe('30ms c', CLEANUP);
    });
  });
});
